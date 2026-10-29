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
  /** The entity this object shows part of (spec §2.1), if it's marked with one. */
  entity?: string;
  /** Its properties' schemas without annotations, to check them against the entity's. */
  schemas: Record<string, unknown>;
}

export interface EnumDef {
  kind: "enum";
  path: string[];
  values: string[];
  description?: string;
}

/** A string an island or app shows (spec §2, §4.7): its key and the values it takes. */
export interface StringDef {
  key: string;
  /** The values the client fills in, in declared order. */
  params: string[];
  /** It has variants by number: `params` includes `count`. */
  counted: boolean;
  description?: string;
}

export interface Island {
  type: string;
  version: number;
  description?: string;
  source: string;
  props: ObjectDef;
  /** Its declared strings, by key order; empty when it declares none. */
  strings: StringDef[];
}

/** The strings an app shows outside any island (spec §4.7). */
export interface AppStrings {
  source: string;
  description?: string;
  strings: StringDef[];
}

/** A screen's own strings (spec §4.7): the words its composer uses itself, e.g. for its meta. */
export interface ScreenStringsDef {
  screen: string;
  strings: StringDef[];
}

/** The screen strings manifest: each screen's own strings, by screen id. */
export interface ScreenStrings {
  source: string;
  screens: ScreenStringsDef[];
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

/** A thing several islands may show (spec §2.1), so actions can say what changed about it. */
export interface Entity {
  entity: string;
  description?: string;
  source: string;
  /** The property that identifies one: a string. */
  id: string;
  /** Its properties, lowered: what an action can set. */
  def: ObjectDef;
}

/** Where an island's props hold an entity (spec §2.1), for clients to apply changes to. */
export interface EntityPath {
  /** From the props down: property names, "[]" for an array's items, "{}" for a map's values. */
  path: string[];
  entity: string;
  /** The property that identifies one. */
  id: string;
  /** The entity's properties this object shows, the id among them. */
  properties: string[];
}

export class ManifestError extends Error {}

type Schema = Record<string, unknown>;

/** A JSON object (a schema, or a map of them), as JSON.parse gives it. */
function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

const ANNOTATIONS = new Set(["description", "title", "$comment", "examples"]);
const ALLOWED: Record<string, Set<string>> = {
  object: new Set(["type", "properties", "required", "additionalProperties", "entity"]),
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
        const why = err instanceof Error ? err.message : String(err);
        throw new ManifestError(`${source}: invalid JSON (${why})`);
      }
      return parse(raw, source);
    });
}

export function loadManifests(dir: string): Island[] {
  const islands = readJsonFiles(dir, parseManifest);

  const seen = new Map<string, string>();
  for (const i of islands) {
    const id = `${i.type}@${i.version}`;
    if (seen.has(id)) {
      throw new ManifestError(`${i.source}: ${id} is also defined in ${seen.get(id)}`);
    }
    seen.set(id, i.source);
  }
  return islands.sort((a, b) => a.type.localeCompare(b.type) || a.version - b.version);
}

export function parseManifest(raw: unknown, source: string): Island {
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (!isSchema(raw)) {
    throw at("manifest must be an object");
  }
  const { type, version, props } = raw;
  if (typeof type !== "string" || !ISLAND_TYPE.test(type)) {
    throw at(`"type" must be kebab-case, got ${JSON.stringify(type)}`);
  }
  if (!isPositiveInteger(version)) {
    throw at(`"version" must be a positive integer`);
  }
  if (!isSchema(props) || props.type !== "object") {
    throw at(`"props" must be a JSON Schema with "type": "object"`);
  }
  if (props.additionalProperties !== undefined) {
    throw at(`"props" can't use additionalProperties`);
  }

  const path = [pascal(type), `V${version}`];
  return {
    type,
    version,
    description: str(raw.description),
    source,
    props: lowerObject(props, path, (p, msg) => at(`props${p}: ${msg}`), ""),
    strings: parseStrings(raw.strings, (msg) => at(`strings${msg}`)),
  };
}

export function loadEntities(dir: string): Entity[] {
  const entities = readJsonFiles(dir, parseEntityManifest);
  const seen = new Map<string, string>();
  for (const e of entities) {
    if (seen.has(e.entity)) {
      throw new ManifestError(
        `${e.source}: entity ${e.entity} is also defined in ${seen.get(e.entity)}`,
      );
    }
    seen.set(e.entity, e.source);
  }

  return entities.sort((a, b) => a.entity.localeCompare(b.entity));
}

export function parseEntityManifest(raw: unknown, source: string): Entity {
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (!isSchema(raw)) {
    throw at("manifest must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!["entity", "description", "id", "properties", "$schema", "$comment"].includes(key)) {
      throw at(`unknown field ${JSON.stringify(key)}`);
    }
  }
  const { entity, id, properties } = raw;
  if (typeof entity !== "string" || !ISLAND_TYPE.test(entity)) {
    throw at(`"entity" must be kebab-case, got ${JSON.stringify(entity)}`);
  }
  if (!isSchema(properties)) {
    throw at(`"properties" must map names to schemas`);
  }
  if (typeof id !== "string" || !isSchema(properties[id]) || properties[id].type !== "string") {
    throw at(`"id" must name one of its properties, a string`);
  }
  const def = lowerObject(
    { type: "object", properties },
    [pascal(entity), "Entity"],
    (p, msg) => at(`properties${p}: ${msg}`),
    "",
  );

  return {
    entity,
    description: str(raw.description),
    source,
    id,
    def,
  };
}

/**
 * Checks every object an island marks with an entity against the entity (spec §2.1): it has the
 * entity's id, required, and each of the entity's properties it shows has the entity's schema.
 */
export function checkEntities(islands: Island[], entities: Entity[]): void {
  const byName = new Map(entities.map((e) => [e.entity, e]));
  for (const island of islands) {
    for (const found of entityPaths(island.props)) {
      const entity = byName.get(found.def.entity ?? "");
      const where = `${island.source}: props${found.path.map((s) => (s.startsWith("[") || s.startsWith("{") ? s : `.${s}`)).join("")}`;
      if (!entity) {
        throw new ManifestError(
          `${where}: no entity ${JSON.stringify(found.def.entity)} (add entities/${found.def.entity}.json)`,
        );
      }
      const id = found.def.fields.find((f) => f.jsonName === entity.id);
      if (!id?.required) {
        throw new ManifestError(
          `${where}: shows ${entity.entity}, so it needs its id, ${JSON.stringify(entity.id)}, required`,
        );
      }
      const schemas = entity.def.schemas;
      for (const [name, schema] of Object.entries(found.def.schemas)) {
        if (name in schemas && JSON.stringify(schema) !== JSON.stringify(schemas[name])) {
          throw new ManifestError(
            `${where}.${name}: must have ${entity.entity}'s schema for it, ${JSON.stringify(schemas[name])}`,
          );
        }
      }
    }
  }
}

/** Where an island's props hold entities, for its descriptor (spec §2.1). */
export function islandEntityPaths(island: Island, entities: Entity[]): EntityPath[] {
  const byName = new Map(entities.map((e) => [e.entity, e]));
  return entityPaths(island.props).flatMap(({ path, def }) => {
    const entity = byName.get(def.entity ?? "");
    if (!entity) {
      return [];
    }
    const properties = def.fields.map((f) => f.jsonName).filter((n) => n in entity.def.schemas);

    return [
      {
        path,
        entity: entity.entity,
        id: entity.id,
        properties,
      },
    ];
  });
}

/** Each marked object in a props tree, with its path from the props down. */
function entityPaths(root: ObjectDef): { path: string[]; def: ObjectDef }[] {
  const out: { path: string[]; def: ObjectDef }[] = [];
  const visitType = (type: TypeRef, path: string[]) => {
    if (type.kind === "object") {
      visitObject(type.def, path);
    } else if (type.kind === "array") {
      visitType(type.items, [...path, "[]"]);
    } else if (type.kind === "map") {
      visitType(type.values, [...path, "{}"]);
    }
  };
  const visitObject = (def: ObjectDef, path: string[]) => {
    if (def.entity) {
      out.push({ path, def });
    }
    for (const field of def.fields) {
      visitType(field.type, [...path, field.jsonName]);
    }
  };
  visitObject(root, []);

  return out;
}

/** The app strings manifest (spec §4.7): `{ "strings": { … } }`, in the island manifest's format. */
export function loadAppStrings(file: string): AppStrings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new ManifestError(`${file}: invalid JSON (${why})`);
  }
  return parseAppStrings(raw, file);
}

export function parseAppStrings(raw: unknown, source: string): AppStrings {
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (!isSchema(raw) || raw.strings === undefined) {
    throw at(`an app strings manifest is an object with "strings"`);
  }
  return {
    source,
    description: str(raw.description),
    strings: parseStrings(raw.strings, (msg) => at(`strings${msg}`)),
  };
}

/** The screen strings manifest (spec §4.7): `{ "screens": { "<screen>": { <strings> } } }`. */
export function loadScreenStrings(file: string): ScreenStrings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new ManifestError(`${file}: invalid JSON (${why})`);
  }
  return parseScreenStrings(raw, file);
}

const SCREEN_ID = /^[a-z][a-z0-9-]*$/;

export function parseScreenStrings(raw: unknown, source: string): ScreenStrings {
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (!isSchema(raw) || !isSchema(raw.screens)) {
    throw at(`a screen strings manifest is an object with "screens": strings by screen id`);
  }
  return {
    source,
    screens: Object.entries(raw.screens).map(([screen, strings]) => {
      if (!SCREEN_ID.test(screen)) {
        throw at(`screens.${screen}: a screen id is lowercase letters, digits and hyphens`);
      }
      return { screen, strings: parseStrings(strings, (msg) => at(`screens.${screen}${msg}`)) };
    }),
  };
}

const STRING_KEY = /^[a-z][A-Za-z0-9]*$/;

/** A manifest's `strings`: key -> { params?, counted?, description? }. */
function parseStrings(raw: unknown, at: (msg: string) => ManifestError): StringDef[] {
  if (raw === undefined) {
    return [];
  }
  if (!isSchema(raw)) {
    throw at(": must be an object of strings by key");
  }
  return Object.entries(raw).map(([key, def]): StringDef => {
    if (!STRING_KEY.test(key)) {
      throw at(`.${key}: a string's key is camelCase`);
    }
    if (!isSchema(def)) {
      throw at(`.${key}: must be an object ({} for a string without params)`);
    }
    for (const field of Object.keys(def)) {
      if (!["params", "counted", "description"].includes(field)) {
        throw at(`.${key}: unknown field ${JSON.stringify(field)}`);
      }
    }
    const params = def.params ?? [];
    if (!isStringArray(params) || params.some((p) => !STRING_KEY.test(p))) {
      throw at(`.${key}.params: a list of camelCase names`);
    }
    if (new Set(params).size !== params.length) {
      throw at(`.${key}.params: names a param twice`);
    }
    if (def.counted !== undefined && typeof def.counted !== "boolean") {
      throw at(`.${key}.counted: true or false`);
    }
    const counted = def.counted === true;
    if (counted && !params.includes("count")) {
      throw at(`.${key}: a counted string takes a "count" param`);
    }
    return {
      key,
      params,
      counted,
      description: str(def.description),
    };
  });
}

export function loadActionManifests(dir: string): Action[] {
  const actions = readJsonFiles(dir, parseActionManifest);
  const seen = new Map<string, string>();
  for (const a of actions) {
    const id = `${a.action}@${a.version}`;
    if (seen.has(id)) {
      throw new ManifestError(`${a.source}: action ${id} is also defined in ${seen.get(id)}`);
    }
    seen.set(id, a.source);
  }
  return actions.sort((a, b) => a.action.localeCompare(b.action) || a.version - b.version);
}

export function parseActionManifest(raw: unknown, source: string): Action {
  const at = (msg: string) => new ManifestError(`${source}: ${msg}`);
  if (!isSchema(raw)) {
    throw at("manifest must be an object");
  }
  const m = raw;
  const { action, version } = m;
  if (typeof action !== "string" || !ISLAND_TYPE.test(action)) {
    throw at(`"action" must be kebab-case, got ${JSON.stringify(action)}`);
  }
  if (!isPositiveInteger(version)) {
    throw at(`"version" must be a positive integer`);
  }
  for (const key of Object.keys(m)) {
    if (
      ![
        "action",
        "version",
        "description",
        "input",
        "result",
        "errors",
        "$schema",
        "$comment",
      ].includes(key)
    ) {
      throw at(`unknown field ${JSON.stringify(key)}`);
    }
  }
  const base = [pascal(action), `V${version}`];
  const object = (field: string, schema: unknown, path: string[]): ObjectDef => {
    if (!isSchema(schema) || schema.type !== "object") {
      throw at(`"${field}" must be a JSON Schema with "type": "object"`);
    }
    if (schema.additionalProperties !== undefined) {
      throw at(`"${field}" can't use additionalProperties`);
    }
    return lowerObject(schema, path, (p, msg) => at(`${field}${p}: ${msg}`), "");
  };

  const input = object("input", m.input, [...base, "Input"]);
  const result = object("result", m.result, [...base, "Result"]);
  const errors: ActionErrorDef[] = [];
  if (m.errors !== undefined) {
    if (!isSchema(m.errors)) {
      throw at(`"errors" must be an object keyed by error code`);
    }
    for (const [code, def] of Object.entries(m.errors)) {
      if (!ERROR_CODE.test(code)) {
        throw at(`error code ${JSON.stringify(code)} must be snake_case`);
      }
      if (!isSchema(def)) {
        throw at(`errors.${code} must be an object`);
      }
      for (const key of Object.keys(def)) {
        if (key !== "description" && key !== "details") {
          throw at(`errors.${code}: unknown field ${JSON.stringify(key)}`);
        }
      }
      const path = [...base, pascal(code)];
      errors.push({
        code,
        description: str(def.description),
        path,
        details:
          def.details === undefined
            ? undefined
            : object(`errors.${code}.details`, def.details, path),
      });
    }
  }
  return {
    action,
    version,
    description: str(m.description),
    source,
    input,
    result,
    errors,
    // `input` is an object schema (checked above), so it stays one.
    inputSchema: isSchema(m.input) ? stripObject(m.input) : {},
  };
}

function stripAnnotations(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(stripAnnotations);
  }
  return isSchema(schema) ? stripObject(schema) : schema;
}

/** A schema without its annotations (descriptions, titles, comments, examples), all the way down. */
function stripObject(schema: Schema): Schema {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) {
    if (ANNOTATIONS.has(k)) {
      continue;
    }
    // "properties" maps names to schemas: its keys are property names, not keywords.
    out[k] =
      k === "properties" && isSchema(v)
        ? Object.fromEntries(Object.entries(v).map(([n, s]) => [n, stripAnnotations(s)]))
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
  const properties = schema.properties ?? {};
  if (!isSchema(properties)) {
    throw err(ptr, `"properties" must map names to schemas`);
  }
  const required = schema.required ?? [];
  if (!isStringArray(required)) {
    throw err(ptr, `"required" must be a list of names`);
  }
  for (const r of required) {
    if (!(r in properties)) {
      throw err(ptr, `"required" lists unknown property ${JSON.stringify(r)}`);
    }
  }

  if (
    schema.entity !== undefined &&
    (typeof schema.entity !== "string" || !ISLAND_TYPE.test(schema.entity))
  ) {
    throw err(ptr, `"entity" must name an entity, in kebab-case`);
  }
  const def: ObjectDef = {
    kind: "object",
    path,
    fields: [],
    children: [],
    description: str(schema.description),
    entity: str(schema.entity),
    schemas: Object.fromEntries(
      Object.entries(properties).map(([name, s]) => [name, stripAnnotations(s)]),
    ),
  };
  const childNames = new Set<string>();
  const nameChild = (name: string, p: string) => {
    if (childNames.has(name)) {
      throw err(p, `two nested types would both be named ${name}; set "title" on one`);
    }
    childNames.add(name);
    return [...path, name];
  };

  for (const [jsonName, propSchema] of Object.entries(properties)) {
    const p = `${ptr}.${jsonName}`;
    if (!isSchema(propSchema)) {
      throw err(p, "schema must be an object");
    }
    const type = lowerType(
      propSchema,
      p,
      err,
      (s, suffix) => nameChild(pascal(str(s.title) ?? jsonName) + (s.title ? "" : suffix), p),
      def,
    );
    def.fields.push({
      jsonName,
      type,
      required: required.includes(jsonName),
      description: str(propSchema.description),
    });
  }
  return def;
}

function lowerType(
  schema: unknown,
  ptr: string,
  err: (p: string, msg: string) => ManifestError,
  childPath: (schema: Schema, suffix: string) => string[],
  parent: ObjectDef,
): TypeRef {
  if (!isSchema(schema)) {
    throw err(ptr, "schema must be an object");
  }
  const type = schema.type;
  if (typeof type !== "string" || !(type in ALLOWED)) {
    throw err(
      ptr,
      `"type" must be one of ${Object.keys(ALLOWED).join(", ")} (type unions and $ref aren't supported)`,
    );
  }
  for (const key of Object.keys(schema)) {
    if (!ALLOWED[type].has(key) && !ANNOTATIONS.has(key)) {
      throw err(ptr, `unsupported keyword "${key}" for type ${type}`);
    }
  }

  switch (type) {
    case "string": {
      if (schema.enum !== undefined) {
        const values = schema.enum;
        if (!isStringArray(values) || values.length === 0) {
          throw err(ptr, `"enum" must be a non-empty list of strings`);
        }
        if (new Set(values).size !== values.length) {
          throw err(ptr, `"enum" has duplicate values`);
        }
        const def: EnumDef = {
          kind: "enum",
          path: childPath(schema, ""),
          values,
          description: str(schema.description),
        };
        parent.children.push(def);
        return { kind: "enum", def };
      }
      if (schema.format === undefined) {
        return { kind: "string" };
      }
      if (schema.format !== "uri") {
        throw err(
          ptr,
          `string format ${JSON.stringify(schema.format)} isn't supported (only "uri")`,
        );
      }
      return { kind: "string", format: "uri" };
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
      if (!isSchema(schema.items)) {
        throw err(ptr, `arrays need an "items" schema`);
      }
      return {
        kind: "array",
        items: lowerType(schema.items, `${ptr}[]`, err, (s) => childPath(s, "Item"), parent),
      };
    case "object": {
      const ap = schema.additionalProperties;
      if (ap !== undefined) {
        if (schema.properties !== undefined) {
          throw err(ptr, `use either "properties" or "additionalProperties", not both`);
        }
        if (!isSchema(ap)) {
          throw err(ptr, `"additionalProperties" must be a schema (maps only)`);
        }
        return {
          kind: "map",
          values: lowerType(ap, `${ptr}{}`, err, (s) => childPath(s, "Value"), parent),
        };
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

export const pascal = (s: string) =>
  words(s)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("") || "X";

export const camel = (s: string) => {
  const p = pascal(s);
  const c = p[0].toLowerCase() + p.slice(1);
  return /^[0-9]/.test(c) ? `_${c}` : c;
};
