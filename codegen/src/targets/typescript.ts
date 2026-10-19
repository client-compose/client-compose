import type { EnumDef, Island, ObjectDef, TypeRef } from "../manifest.ts";

export interface TypeScriptOptions {
  /** Module that exports `IslandDescriptor`. */
  protocolImport?: string;
}

const flat = (path: string[]) => path.join("");
const key = (name: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name));

export function generateTypeScript(islands: Island[], header: string, opts: TypeScriptOptions = {}): string {
  const out: string[] = [
    header.replace(/^/gm, "// "),
    "",
    `import type { IslandDescriptor } from ${JSON.stringify(opts.protocolImport ?? "@client-compose/protocol")};`,
  ];

  const doc = (indent: string, text?: string) => {
    if (!text) return;
    const lines = text.split("\n");
    if (lines.length === 1) out.push(`${indent}/** ${lines[0]} */`);
    else out.push(`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`);
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
    out.push(`export type ${flat(def.path)} = ${def.values.map((v) => JSON.stringify(v)).join(" | ")};`);
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
    if (def.fields.length) out.push("}");
    if (island) {
      out.push(
        `export const ${name}: IslandDescriptor<${name}> = { type: ${JSON.stringify(island.type)}, version: ${island.version} };`,
      );
    }
    for (const child of def.children) child.kind === "enum" ? emitEnum(child) : emitObject(child);
  };

  for (const island of islands) emitObject(island.props, island);
  return out.join("\n") + "\n";
}
