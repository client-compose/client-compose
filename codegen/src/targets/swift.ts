import { camel, type EnumDef, type Field, type Island, type ObjectDef, type TypeRef } from "../manifest.ts";

export interface SwiftOptions {
  /** Access modifier for generated types, e.g. "public" when generating into a library. */
  access?: "public" | "internal";
}

const RESERVED = new Set(
  ("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator " +
    "private precedencegroup protocol public rethrows static struct subscript typealias var break case catch " +
    "continue default defer do else fallthrough for guard if in repeat return throw switch where while Any as " +
    "await false is nil self Self super throws true try Type")
    .split(" "),
);

const ident = (name: string) => (RESERVED.has(name) ? `\`${name}\`` : name);

export function generateSwift(islands: Island[], header: string, opts: SwiftOptions = {}): string {
  const access = opts.access === "public" ? "public " : "";
  const out: string[] = [header.replace(/^/gm, "// "), "", "import ClientCompose", "import Foundation", ""];

  const doc = (indent: string, text?: string) => {
    if (text) for (const line of text.split("\n")) out.push(`${indent}/// ${line}`);
  };

  const typeName = (t: TypeRef): string => {
    switch (t.kind) {
      case "string":
        return t.format === "uri" ? "URL" : "String";
      case "integer":
        return t.int64 ? "Int64" : "Int";
      case "number":
        return "Double";
      case "boolean":
        return "Bool";
      case "array":
        return `[${typeName(t.items)}]`;
      case "map":
        return `[String: ${typeName(t.values)}]`;
      case "object":
      case "enum":
        // Nested types are declared inside their parent, so a relative name resolves.
        return t.def.path[t.def.path.length - 1];
    }
  };

  const emitEnum = (def: EnumDef, indent: string) => {
    doc(indent, def.description);
    out.push(`${indent}${access}enum ${def.path[def.path.length - 1]}: String, Decodable, Equatable, Sendable {`);
    for (const v of def.values) {
      const c = camel(v);
      out.push(`${indent}    case ${ident(c)}${c === v ? "" : ` = ${JSON.stringify(v)}`}`);
    }
    out.push(`${indent}}`);
  };

  const emitObject = (def: ObjectDef, indent: string, island?: Island) => {
    const name = island ? def.path.join("") : def.path[def.path.length - 1];
    doc(indent, island?.description ?? def.description);
    const conformances = island ? "IslandProps, Equatable, Sendable" : "Decodable, Equatable, Sendable";
    out.push(`${indent}${access}struct ${name}: ${conformances} {`);
    const inner = indent + "    ";
    if (island) {
      out.push(`${inner}${access}static let islandType = ${JSON.stringify(island.type)}`);
      out.push(`${inner}${access}static let islandVersion = ${island.version}`);
      if (def.fields.length) out.push("");
    }
    for (const f of def.fields) emitField(f, inner);
    if (def.fields.some((f) => camel(f.jsonName) !== f.jsonName)) {
      out.push("", `${inner}enum CodingKeys: String, CodingKey {`);
      for (const f of def.fields) {
        const c = camel(f.jsonName);
        out.push(`${inner}    case ${ident(c)}${c === f.jsonName ? "" : ` = ${JSON.stringify(f.jsonName)}`}`);
      }
      out.push(`${inner}}`);
    }
    for (const child of def.children) {
      out.push("");
      child.kind === "enum" ? emitEnum(child, inner) : emitObject(child, inner);
    }
    out.push(`${indent}}`);
  };

  const emitField = (f: Field, indent: string) => {
    doc(indent, f.description);
    out.push(`${indent}${access}let ${ident(camel(f.jsonName))}: ${typeName(f.type)}${f.required ? "" : "?"}`);
  };

  islands.forEach((island, i) => {
    if (i > 0) out.push("");
    emitObject(island.props, "", island);
  });
  return out.join("\n") + "\n";
}
