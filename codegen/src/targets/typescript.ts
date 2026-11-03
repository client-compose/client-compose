import { emit, type Model, type Role, type Target } from "../emit.ts";
import {
  type Action,
  type AppStrings,
  type Entity,
  type Island,
  type ObjectDef,
  pascal,
  type ScreenStringsDef,
  type SharedType,
  type StringDef,
  type TypeRef,
} from "../manifest.ts";

export interface TypeScriptOptions {
  /** Module that exports `IslandDescriptor` (and `ActionDescriptor`, if there are actions). */
  protocolImport?: string;
}

const flat = (path: string[]) => path.join("");
const key = (name: string) =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);

export function generateTypeScript(
  islands: Island[],
  header: string,
  opts: TypeScriptOptions = {},
  actions: Action[] = [],
  app?: AppStrings,
  screens: ScreenStringsDef[] = [],
  entities: Entity[] = [],
  types: SharedType[] = [],
): string {
  return emit(
    {
      islands,
      actions,
      entities,
      types,
      screens,
      app,
      header,
    },
    typescript(opts),
  );
}

/** A doc comment: one line, or a block. */
function doc(indent: string, text?: string): string[] {
  if (!text) {
    return [];
  }
  const lines = text.split("\n");
  if (lines.length === 1) {
    return [`${indent}/** ${lines[0]} */`];
  }
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`];
}

function typeName(t: TypeRef): string {
  switch (t.kind) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array": {
      const inner = typeName(t.items);
      return /^[A-Za-z0-9_]+$/.test(inner) ? `${inner}[]` : `Array<${inner}>`;
    }
    case "map":
      return `Record<string, ${typeName(t.values)}>`;
    case "object":
    case "enum":
      return flat(t.def.path);
  }
}

/** An interface for an object type, with its doc comment. */
function iface(def: ObjectDef, description: string | undefined): string[] {
  const name = flat(def.path);
  const out = [
    "",
    ...doc("", description),
    `export interface ${name} {${def.fields.length ? "" : "}"}`,
  ];
  for (const f of def.fields) {
    out.push(
      ...doc("  ", f.description),
      `  ${key(f.jsonName)}${f.required ? "" : "?"}: ${typeName(f.type)};`,
    );
  }
  if (def.fields.length) {
    out.push("}");
  }
  return out;
}

/** A strings type: text for a string without params, a function of its params otherwise. */
function stringsType(name: string, defs: StringDef[], description: string): string[] {
  const out = ["", ...doc("", description), `export interface ${name} {`];
  for (const d of defs) {
    const values = d.params.map(
      (p) => `${key(p)}: ${p === "count" ? "number" : "string | number"}`,
    );
    out.push(
      ...doc("  ", d.description),
      `  ${key(d.key)}: ${d.params.length === 0 ? "string" : `(values: { ${values.join("; ")} }) => string`};`,
    );
  }
  out.push("}");
  return out;
}

const paramsOf = (defs: StringDef[]) =>
  `{ ${defs.map((d) => `${key(d.key)}: [${d.params.map((p) => JSON.stringify(p)).join(", ")}]`).join(", ")} }`;

/** An island's props interface, its strings type if it declares any, and its descriptor. */
function island(def: ObjectDef, role: Extract<Role, { kind: "island" }>): string[] {
  const { island: i, entityPaths: paths } = role;
  const name = flat(def.path);
  const out = iface(def, i.description ?? def.description);
  const entityLines = paths.length
    ? [
        `  entities: [`,
        ...paths.map(
          (p) =>
            `    { path: ${JSON.stringify(p.path)}, entity: ${JSON.stringify(p.entity)}, id: ${JSON.stringify(p.id)}, properties: ${JSON.stringify(p.properties)} },`,
        ),
        `  ],`,
      ]
    : [];
  if (i.strings.length === 0 && paths.length === 0) {
    out.push(
      `export const ${name}: IslandDescriptor<${name}> = { type: ${JSON.stringify(i.type)}, version: ${i.version} };`,
    );
  } else if (i.strings.length === 0) {
    out.push(
      `export const ${name}: IslandDescriptor<${name}> = {`,
      `  type: ${JSON.stringify(i.type)},`,
      `  version: ${i.version},`,
      ...entityLines,
      `};`,
    );
  } else {
    const strings = `${name}Strings`;
    out.push(
      ...stringsType(
        strings,
        i.strings,
        `${i.type} v${i.version}'s strings: its component's \`t\`.`,
      ),
      `export const ${name}: IslandDescriptor<${name}, ${strings}> = {`,
      `  type: ${JSON.stringify(i.type)},`,
      `  version: ${i.version},`,
      `  strings: ${paramsOf(i.strings)},`,
      ...entityLines,
      `};`,
    );
  }
  return out;
}

/** TypeScript: interfaces, string unions, and the descriptors clients and composers register. */
export function typescript(opts: TypeScriptOptions = {}): Target {
  return {
    prelude: (model: Model) => {
      const { islands, actions, entities, screens, app } = model;
      const imports = [
        ...(entities.length ? ["EntityDescriptor"] : []),
        ...(app ? ["AppStringsDescriptor"] : []),
        ...(screens.length ? ["ScreenStringsDescriptor"] : []),
        ...(islands.length || (!actions.length && !app) ? ["IslandDescriptor"] : []),
        ...(actions.length ? ["ActionDescriptor"] : []),
      ];
      return [
        model.header.replace(/^/gm, "// "),
        "",
        `import type { ${imports.join(", ")} } from ${JSON.stringify(opts.protocolImport ?? "@client-compose/protocol")};`,
      ];
    },
    appStrings: (app) => [
      ...stringsType(
        "AppStrings",
        app.strings,
        app.description ?? "The app's strings, outside any island.",
      ),
      `export const AppStrings: AppStringsDescriptor<AppStrings> = { strings: ${paramsOf(app.strings)} };`,
    ],
    screenStrings: (s) => {
      const name = `${pascal(s.screen)}ScreenStrings`;
      return [
        ...stringsType(
          name,
          s.strings,
          `The ${s.screen} screen's own strings: read them with \`lc.strings(${name})\`.`,
        ),
        `export const ${name}: ScreenStringsDescriptor<${name}> = { screen: ${JSON.stringify(s.screen)}, strings: ${paramsOf(s.strings)} };`,
      ];
    },
    enumeration: (def) => [
      "",
      ...doc("", def.description),
      `export type ${flat(def.path)} = ${def.values.map((v) => JSON.stringify(v)).join(" | ")};`,
    ],
    object: (def, role) => {
      switch (role.kind) {
        case "island":
          return island(def, role);
        case "error":
          // An error without details has no type in TypeScript: its union member says so.
          return role.error.details ? iface(def, role.error.description ?? def.description) : [];
        default:
          return iface(def, def.description);
      }
    },
    afterChildren: (def, role) => {
      if (role.kind !== "entity") {
        return [];
      }
      const name = flat(def.path);
      return [
        `export const ${name}: EntityDescriptor<${name}> = { entity: ${JSON.stringify(role.entity.entity)} };`,
      ];
    },
    afterAction: (action) => {
      const name = flat(action.input.path.slice(0, -1));
      const [input, result, error] = [
        flat(action.input.path),
        flat(action.result.path),
        `${name}Error`,
      ];
      const out = [""];
      if (action.errors.length === 0) {
        out.push(
          `/** Declared errors of action ${JSON.stringify(action.action)} v${action.version}: none. */`,
          `export type ${error} = never;`,
        );
      } else {
        out.push(
          `/**`,
          ` * Declared errors of action ${JSON.stringify(action.action)} v${action.version}. A newer composer may send codes`,
          ` * that aren't listed yet: handle unknown codes as a generic failure.`,
          ` */`,
          `export type ${error} =`,
          ...action.errors.map(
            (e, i) =>
              `  | { code: ${JSON.stringify(e.code)}; message?: string${e.details ? `; details: ${flat(e.details.path)}` : ""} }${i === action.errors.length - 1 ? ";" : ""}`,
          ),
        );
      }
      out.push(
        "",
        ...doc("", action.description),
        `export const ${name}: ActionDescriptor<${input}, ${result}, ${error}> = {`,
        `  action: ${JSON.stringify(action.action)},`,
        `  version: ${action.version},`,
        `  errors: [${action.errors.map((e) => JSON.stringify(e.code)).join(", ")}],`,
        `  input: ${JSON.stringify(action.inputSchema, null, 2).replace(/\n/g, "\n  ")},`,
        `};`,
      );
      return out;
    },
  };
}
