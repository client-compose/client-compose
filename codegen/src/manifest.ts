// Loads island manifests and lowers their props schemas into a small, language-neutral IR.
// Only a deliberately small subset of JSON Schema is supported; anything else is an error,
// so a manifest never silently means something different in different languages.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TypeRef =
  | { kind: "string"; format?: "uri" }
  | { kind: "integer"; int64: boolean }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "array"; items: TypeRef }
  | { kind: "map"; values: TypeRef }
  | { kind: "object"; def: ObjectDef }
  | { kind: "enum"; def: EnumDef };

export interface Field {
  jsonName: string;
  type: TypeRef;
  required: boolean;
  description?: string;
}

export interface ObjectDef {
  kind: "object";
  /** Name segments from the island down, e.g. ["PostGrid", "V1", "Post"] -> joined per language. */
  path: string[];
  fields: Field[];
  /** Object and enum types defined by this object's fields, in field order. */
  children: (ObjectDef | EnumDef)[];
  description?: string;
}

export interface EnumDef {
  kind: "enum";
  path: string[];
  values: string[];
  description?: string;
}

export interface Island {
  type: string;
  version: number;
  description?: string;
  source: string;
  props: ObjectDef;
}

export interface ActionErrorDef {
  /** snake_case, e.g. "name_taken". */
  code: string;
  description?: string;
  /** Path ends in the error's own name, e.g. ["FollowUser", "V1", "LimitReached"]. */
  path: string[];
  details?: ObjectDef;
}

export interface Action {
  action: string;
  version: number;
  description?: string;
  source: string;
  input: ObjectDef;
  result: ObjectDef;
  errors: ActionErrorDef[];
  /** The input schema without annotations, for composers to validate requests against. */
  inputSchema: Record<string, unknown>;
}

export class ManifestError extends Error {}

type Schema = Record<string, unknown>;

const ANNOTATIONS = new Set(["description", "title", "$comment", "examples"]);
const ALLOWED: Record<string, Set<string>> = {
  object: new Set(["type", "properties", "required", "additionalProperties"]),
  array: new Set(["type", "items"]),
  string: new Set(["type", "format", "enum"]),
  integer: new Set(["type", "format"]),
  number: new Set(["type"]),
  boolean: new Set(["type"]),
};
const ISLAND_TYPE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ERROR_CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

function readJsonFiles<T>(dir: string, parse: (raw: unknown, source: string) => T): T[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const source = join(dir, f);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(source, "utf8"));
      } catch (err) {
        throw new ManifestError(`${source}: invalid JSON (${(err as Error).message})`);
      }
      return parse(raw, source);
    });
}

export function loadManifests(dir: string): Island[] {
  const islands = readJsonFiles(dir, parseManifest);

  const seen = new Map<string, string>();
  for (const i of islands) {
    const id = `${i.type}@${i.version}`;
    if (seen.has(id)) throw new ManifestError(`${i.source}: ${id} is also defined in ${seen.get(id)}`);
    seen.set(id, i.source);
  }
  return islands.sort((a, b) => a.type.localeCompare(b.type) || a.version - b.version);
}

export function parseManifest(raw: unknown, source: string): Island {
  const m = raw as Schema;
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (typeof m !== "object" || m === null) throw at("manifest must be an object");
  if (typeof m.type !== "string" || !ISLAND_TYPE.test(m.type)) throw at(`"type" must be kebab-case, got ${JSON.stringify(m.type)}`);
  if (!Number.isInteger(m.version) || (m.version as number) < 1) throw at(`"version" must be a positive integer`);
  if (typeof m.props !== "object" || m.props === null || (m.props as Schema).type !== "object") {
    throw at(`"props" must be a JSON Schema with "type": "object"`);
  }
  if ((m.props as Schema).additionalProperties !== undefined) throw at(`"props" can't use additionalProperties`);

  const path = [pascal(m.type), `V${m.version}`];
  const props = lowerObject(m.props as Schema, path, (p, msg) => at(`props${p}: ${msg}`), "");
  return { type: m.type, version: m.version as number, description: str(m.description), source, props };
}

export function loadActionManifests(dir: string): Action[] {
  const actions = readJsonFiles(dir, parseActionManifest);
  const seen = new Map<string, string>();
  for (const a of actions) {
    const id = `${a.action}@${a.version}`;
    if (seen.has(id)) throw new ManifestError(`${a.source}: action ${id} is also defined in ${seen.get(id)}`);
    seen.set(id, a.source);
  }
  return actions.sort((a, b) => a.action.localeCompare(b.action) || a.version - b.version);
}

export function parseActionManifest(raw: unknown, source: string): Action {
  const m = raw as Schema;
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (typeof m !== "object" || m === null) throw at("manifest must be an object");
  if (typeof m.action !== "string" || !ISLAND_TYPE.test(m.action)) {
    throw at(`"action" must be kebab-case, got ${JSON.stringify(m.action)}`);
  }
  if (!Number.isInteger(m.version) || (m.version as number) < 1) throw at(`"version" must be a positive integer`);
  for (const key of Object.keys(m)) {
    if (!["action", "version", "description", "input", "result", "errors", "$schema", "$comment"].includes(key)) {
      throw at(`unknown field ${JSON.stringify(key)}`);
    }
  }
  const base = [pascal(m.action), `V${m.version}`];
  const object = (field: string, schema: unknown, path: string[]): ObjectDef => {
    if (typeof schema !== "object" || schema === null || (schema as Schema).type !== "object") {
      throw at(`"${field}" must be a JSON Schema with "type": "object"`);
    }
    if ((schema as Schema).additionalProperties !== undefined) throw at(`"${field}" can't use additionalProperties`);
    return lowerObject(schema as Schema, path, (p, msg) => at(`${field}${p}: ${msg}`), "");
  };

  const input = object("input", m.input, [...base, "Input"]);
  const result = object("result", m.result, [...base, "Result"]);
  const errors: ActionErrorDef[] = [];
  if (m.errors !== undefined) {
    if (typeof m.errors !== "object" || m.errors === null || Array.isArray(m.errors)) {
      throw at(`"errors" must be an object keyed by error code`);
    }
    for (const [code, def] of Object.entries(m.errors as Record<string, Schema>)) {
      if (!ERROR_CODE.test(code)) throw at(`error code ${JSON.stringify(code)} must be snake_case`);
      if (typeof def !== "object" || def === null) throw at(`errors.${code} must be an object`);
      for (const key of Object.keys(def)) {
        if (key !== "description" && key !== "details") throw at(`errors.${code}: unknown field ${JSON.stringify(key)}`);
      }
      const path = [...base, pascal(code)];
      errors.push({
        code,
        description: str(def.description),
        path,
        details: def.details === undefined ? undefined : object(`errors.${code}.details`, def.details, path),
      });
    }
  }
  return {
    action: m.action,
    version: m.version as number,
    description: str(m.description),
    source,
    input,
    result,
    errors,
    inputSchema: stripAnnotations(m.input) as Record<string, unknown>,
  };
}

function stripAnnotations(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripAnnotations);
  if (typeof schema !== "object" || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (ANNOTATIONS.has(k)) continue;
    // "properties" maps names to schemas: its keys are property names, not keywords.
    out[k] =
      k === "properties"
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([n, s]) => [n, stripAnnotations(s)]))
        : stripAnnotations(v);
  }
  return out;
}

function lowerObject(
  schema: Schema,
  path: string[],
  err: (p: string, msg: string) => ManifestError,
  ptr: string,
): ObjectDef {
  const properties = (schema.properties ?? {}) as Record<string, Schema>;
  const required = (schema.required ?? []) as string[];
  if (!Array.isArray(required) || required.some((r) => typeof r !== "string")) throw err(ptr, `"required" must be a list of names`);
  for (const r of required) if (!(r in properties)) throw err(ptr, `"required" lists unknown property ${JSON.stringify(r)}`);

  const def: ObjectDef = { kind: "object", path, fields: [], children: [], description: str(schema.description) };
  const childNames = new Set<string>();
  const nameChild = (name: string, p: string) => {
    if (childNames.has(name)) throw err(p, `two nested types would both be named ${name}; set "title" on one`);
    childNames.add(name);
    return [...path, name];
  };

  for (const [jsonName, propSchema] of Object.entries(properties)) {
    const p = `${ptr}.${jsonName}`;
    const type = lowerType(propSchema, p, err, (s, suffix) => nameChild(pascal(str(s.title) ?? jsonName) + (s.title ? "" : suffix), p), def);
    def.fields.push({ jsonName, type, required: required.includes(jsonName), description: str(propSchema.description) });
  }
  return def;
}

function lowerType(
  schema: Schema,
  ptr: string,
  err: (p: string, msg: string) => ManifestError,
  childPath: (schema: Schema, suffix: string) => string[],
  parent: ObjectDef,
): TypeRef {
  if (typeof schema !== "object" || schema === null) throw err(ptr, "schema must be an object");
  const type = schema.type;
  if (typeof type !== "string" || !(type in ALLOWED)) {
    throw err(ptr, `"type" must be one of ${Object.keys(ALLOWED).join(", ")} (type unions and $ref aren't supported)`);
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED[type].has(key) && !ANNOTATIONS.has(key)) throw err(ptr, `unsupported keyword "${key}" for type ${type}`);
  }

  switch (type) {
    case "string": {
      if (schema.enum !== undefined) {
        const values = schema.enum as unknown[];
        if (!Array.isArray(values) || values.length === 0 || values.some((v) => typeof v !== "string")) {
          throw err(ptr, `"enum" must be a non-empty list of strings`);
        }
        if (new Set(values).size !== values.length) throw err(ptr, `"enum" has duplicate values`);
        const def: EnumDef = { kind: "enum", path: childPath(schema, ""), values: values as string[], description: str(schema.description) };
        parent.children.push(def);
        return { kind: "enum", def };
      }
      if (schema.format !== undefined && schema.format !== "uri") {
        throw err(ptr, `string format ${JSON.stringify(schema.format)} isn't supported (only "uri")`);
      }
      return { kind: "string", format: schema.format as "uri" | undefined };
    }
    case "integer":
      if (schema.format !== undefined && schema.format !== "int32" && schema.format !== "int64") {
        throw err(ptr, `integer format must be "int32" or "int64"`);
      }
      return { kind: "integer", int64: schema.format === "int64" };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "array":
      if (typeof schema.items !== "object" || schema.items === null) throw err(ptr, `arrays need an "items" schema`);
      return { kind: "array", items: lowerType(schema.items as Schema, `${ptr}[]`, err, (s) => childPath(s, "Item"), parent) };
    case "object": {
      const ap = schema.additionalProperties;
      if (ap !== undefined) {
        if (schema.properties !== undefined) throw err(ptr, `use either "properties" or "additionalProperties", not both`);
        if (typeof ap !== "object" || ap === null) throw err(ptr, `"additionalProperties" must be a schema (maps only)`);
        return { kind: "map", values: lowerType(ap as Schema, `${ptr}{}`, err, (s) => childPath(s, "Value"), parent) };
      }
      const def = lowerObject(schema, childPath(schema, ""), err, ptr);
      parent.children.push(def);
      return { kind: "object", def };
    }
  }
  throw err(ptr, "unreachable");
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Split "profile-header", "avatarUrl", "extra_large", "HTTPStatus" into lowercase words. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export const pascal = (s: string) => words(s).map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "X";

export const camel = (s: string) => {
  const p = pascal(s);
  const c = p[0].toLowerCase() + p.slice(1);
  return /^[0-9]/.test(c) ? `_${c}` : c;
};
