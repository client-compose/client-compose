import type { Action, EnumDef, Island, ObjectDef, TypeRef } from "../manifest.ts";

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
): string {
  const imports = [
    ...(islands.length || !actions.length ? ["IslandDescriptor"] : []),
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
    if (island) {
      out.push(
        `export const ${name}: IslandDescriptor<${name}> = { type: ${JSON.stringify(island.type)}, version: ${island.version} };`,
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

  for (const island of islands) {
    emitObject(island.props, island);
  }
  for (const action of actions) {
    emitAction(action);
  }
  return `${out.join("\n")}\n`;
}
