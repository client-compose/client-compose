import {
  type Action,
  type AppStrings,
  type Entity,
  type EnumDef,
  type Island,
  islandEntityPaths,
  type ObjectDef,
  pascal,
  type ScreenStringsDef,
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
): string {
  const imports = [
    ...(entities.length ? ["EntityDescriptor"] : []),
    ...(app ? ["AppStringsDescriptor"] : []),
    ...(screens.length ? ["ScreenStringsDescriptor"] : []),
    ...(islands.length || (!actions.length && !app) ? ["IslandDescriptor"] : []),
    ...(actions.length ? ["ActionDescriptor"] : []),
  ];
  const out: string[] = [
    header.replace(/^/gm, "// "),
    "",
    `import type { ${imports.join(", ")} } from ${JSON.stringify(opts.protocolImport ?? "@client-compose/protocol")};`,
  ];

  const doc = (indent: string, text?: string) => {
    if (!text) {
      return;
    }
    const lines = text.split("\n");
    if (lines.length === 1) {
      out.push(`${indent}/** ${lines[0]} */`);
    } else {
      out.push(`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`);
    }
  };

  const typeName = (t: TypeRef): string => {
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
  };

  const emitEnum = (def: EnumDef) => {
    out.push("");
    doc("", def.description);
    out.push(
      `export type ${flat(def.path)} = ${def.values.map((v) => JSON.stringify(v)).join(" | ")};`,
    );
  };

  const emitObject = (def: ObjectDef, island?: Island) => {
    const name = flat(def.path);
    out.push("");
    doc("", island?.description ?? def.description);
    out.push(`export interface ${name} {${def.fields.length ? "" : "}"}`);
    for (const f of def.fields) {
      doc("  ", f.description);
      out.push(`  ${key(f.jsonName)}${f.required ? "" : "?"}: ${typeName(f.type)};`);
    }
    if (def.fields.length) {
      out.push("}");
    }
    const paths = island ? islandEntityPaths(island, entities) : [];
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
    if (island && island.strings.length === 0 && paths.length === 0) {
      out.push(
        `export const ${name}: IslandDescriptor<${name}> = { type: ${JSON.stringify(island.type)}, version: ${island.version} };`,
      );
    }
    if (island && island.strings.length === 0 && paths.length > 0) {
      out.push(
        `export const ${name}: IslandDescriptor<${name}> = {`,
        `  type: ${JSON.stringify(island.type)},`,
        `  version: ${island.version},`,
        ...entityLines,
        `};`,
      );
    }
    if (island && island.strings.length > 0) {
      const strings = `${name}Strings`;
      emitStrings(
        strings,
        island.strings,
        `${island.type} v${island.version}'s strings: its component's \`t\`.`,
      );
      out.push(
        `export const ${name}: IslandDescriptor<${name}, ${strings}> = {`,
        `  type: ${JSON.stringify(island.type)},`,
        `  version: ${island.version},`,
        `  strings: ${paramsOf(island.strings)},`,
        ...entityLines,
        `};`,
      );
    }
    for (const child of def.children) {
      if (child.kind === "enum") {
        emitEnum(child);
      } else {
        emitObject(child);
      }
    }
  };

  /** A strings type: text for a string without params, a function of its params otherwise. */
  const emitStrings = (name: string, defs: StringDef[], description: string) => {
    out.push("");
    doc("", description);
    out.push(`export interface ${name} {`);
    for (const d of defs) {
      doc("  ", d.description);
      const values = d.params.map(
        (p) => `${key(p)}: ${p === "count" ? "number" : "string | number"}`,
      );
      out.push(
        `  ${key(d.key)}: ${d.params.length === 0 ? "string" : `(values: { ${values.join("; ")} }) => string`};`,
      );
    }
    out.push("}");
  };

  const paramsOf = (defs: StringDef[]) =>
    `{ ${defs.map((d) => `${key(d.key)}: [${d.params.map((p) => JSON.stringify(p)).join(", ")}]`).join(", ")} }`;

  const emitAction = (action: Action) => {
    const name = flat(action.input.path.slice(0, -1));
    const [input, result, error] = [
      flat(action.input.path),
      flat(action.result.path),
      `${name}Error`,
    ];
    emitObject(action.input);
    emitObject(action.result);
    for (const e of action.errors) {
      if (e.details) {
        emitObject({ ...e.details, description: e.description ?? e.details.description });
      }
    }
    out.push("");
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
    out.push("");
    doc("", action.description);
    out.push(
      `export const ${name}: ActionDescriptor<${input}, ${result}, ${error}> = {`,
      `  action: ${JSON.stringify(action.action)},`,
      `  version: ${action.version},`,
      `  errors: [${action.errors.map((e) => JSON.stringify(e.code)).join(", ")}],`,
      `  input: ${JSON.stringify(action.inputSchema, null, 2).replace(/\n/g, "\n  ")},`,
      `};`,
    );
  };

  if (app) {
    emitStrings(
      "AppStrings",
      app.strings,
      app.description ?? "The app's strings, outside any island.",
    );
    out.push(
      `export const AppStrings: AppStringsDescriptor<AppStrings> = { strings: ${paramsOf(app.strings)} };`,
    );
  }
  for (const s of screens) {
    const name = `${pascal(s.screen)}ScreenStrings`;
    emitStrings(
      name,
      s.strings,
      `The ${s.screen} screen's own strings: read them with \`lc.strings(${name})\`.`,
    );
    out.push(
      `export const ${name}: ScreenStringsDescriptor<${name}> = { screen: ${JSON.stringify(s.screen)}, strings: ${paramsOf(s.strings)} };`,
    );
  }
  for (const entity of entities) {
    const name = flat(entity.def.path);
    // What an action sets: every property but the id, which names the entity.
    emitObject({
      ...entity.def,
      fields: entity.def.fields
        .filter((f) => f.jsonName !== entity.id)
        .map((f) => ({ ...f, required: false })),
      description: entity.description,
    });
    out.push(
      `export const ${name}: EntityDescriptor<${name}> = { entity: ${JSON.stringify(entity.entity)} };`,
    );
  }
  for (const island of islands) {
    emitObject(island.props, island);
  }
  for (const action of actions) {
    emitAction(action);
  }
  return `${out.join("\n")}\n`;
}
