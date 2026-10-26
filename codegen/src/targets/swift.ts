import {
  type Action,
  camel,
  type EnumDef,
  type Field,
  type Island,
  type ObjectDef,
  type TypeRef,
} from "../manifest.ts";

export interface SwiftOptions {
  /** Access modifier for generated types, e.g. "public" when generating into a library. */
  access?: "public" | "internal";
}

const RESERVED = new Set(
  (
    "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator " +
    "private precedencegroup protocol public rethrows static struct subscript typealias var break case catch " +
    "continue default defer do else fallthrough for guard if in repeat return throw switch where while Any as " +
    "await false is nil self Self super throws true try Type"
  ).split(" "),
);

const ident = (name: string) => (RESERVED.has(name) ? `\`${name}\`` : name);

export function generateSwift(
  islands: Island[],
  header: string,
  opts: SwiftOptions = {},
  actions: Action[] = [],
): string {
  const access = opts.access === "public" ? "public " : "";
  const out: string[] = [
    header.replace(/^/gm, "// "),
    "",
    "import ClientCompose",
    "import Foundation",
    "",
  ];

  const doc = (indent: string, text?: string) => {
    if (text) {
      for (const line of text.split("\n")) {
        out.push(`${indent}/// ${line}`);
      }
    }
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
    out.push(
      `${indent}${access}enum ${def.path[def.path.length - 1]}: String, Codable, Equatable, Sendable {`,
    );
    for (const v of def.values) {
      const c = camel(v);
      out.push(`${indent}    case ${ident(c)}${c === v ? "" : ` = ${JSON.stringify(v)}`}`);
    }
    out.push(`${indent}}`);
  };

  const emitObject = (def: ObjectDef, indent: string, island?: Island, description?: string) => {
    const name = island ? def.path.join("") : def.path[def.path.length - 1];
    doc(indent, island?.description ?? description ?? def.description);
    const conformances = island
      ? "IslandProps, Codable, Equatable, Sendable"
      : "Codable, Equatable, Sendable";
    out.push(`${indent}${access}struct ${name}: ${conformances} {`);
    const inner = `${indent}    `;
    if (island) {
      out.push(`${inner}${access}static let islandType = ${JSON.stringify(island.type)}`);
      out.push(`${inner}${access}static let islandVersion = ${island.version}`);
      out.push("");
    }
    for (const f of def.fields) {
      emitField(f, inner);
    }
    emitInit(def, inner);
    if (def.fields.some((f) => camel(f.jsonName) !== f.jsonName)) {
      out.push("", `${inner}enum CodingKeys: String, CodingKey {`);
      for (const f of def.fields) {
        const c = camel(f.jsonName);
        out.push(
          `${inner}    case ${ident(c)}${c === f.jsonName ? "" : ` = ${JSON.stringify(f.jsonName)}`}`,
        );
      }
      out.push(`${inner}}`);
    }
    for (const child of def.children) {
      out.push("");
      if (child.kind === "enum") {
        emitEnum(child, inner);
      } else {
        emitObject(child, inner);
      }
    }
    out.push(`${indent}}`);
  };

  // A memberwise initializer, so apps (and tests) can build values, also when the types are public.
  const emitInit = (def: ObjectDef, indent: string) => {
    if (def.fields.length) {
      out.push("");
    }
    const params = def.fields.map(
      (f) => `${ident(camel(f.jsonName))}: ${typeName(f.type)}${f.required ? "" : "? = nil"}`,
    );
    if (!def.fields.length) {
      out.push(`${indent}${access}init() {}`);
      return;
    }
    out.push(`${indent}${access}init(${params.join(", ")}) {`);
    for (const f of def.fields) {
      const name = ident(camel(f.jsonName));
      out.push(`${indent}    self.${name} = ${name}`);
    }
    out.push(`${indent}}`);
  };

  const emitAction = (action: Action) => {
    const name = action.input.path.slice(0, -1).join("");
    const inner = "    ";
    doc("", action.description);
    out.push(`${access}enum ${name}: ActionDescriptor {`);
    out.push(`${inner}${access}static let action = ${JSON.stringify(action.action)}`);
    out.push(`${inner}${access}static let version = ${action.version}`);
    out.push("");
    emitObject(
      action.input,
      inner,
      undefined,
      `The input of ${JSON.stringify(action.action)} v${action.version}.`,
    );
    out.push("");
    emitObject(
      action.result,
      inner,
      undefined,
      `The result of ${JSON.stringify(action.action)} v${action.version}.`,
    );
    out.push("");
    if (action.errors.length === 0) {
      out.push(
        `${inner}/// ${JSON.stringify(action.action)} v${action.version} declares no errors.`,
      );
      out.push(`${inner}${access}typealias DeclaredError = NoDeclaredError`);
      out.push("}");
      return;
    }
    const e2 = `${inner}    `;
    const e3 = `${e2}    `;
    out.push(
      `${inner}/// The errors ${JSON.stringify(action.action)} v${action.version} declares. A newer composer may send codes this`,
      `${inner}/// app doesn't know: \`ComposeClient.perform\` throws those as \`ActionFailure\`.`,
      `${inner}${access}enum DeclaredError: DeclaredActionError {`,
    );
    for (const e of action.errors) {
      doc(e2, e.description);
      const detailsType = e.details ? e.path[e.path.length - 1] : undefined;
      out.push(`${e2}case ${ident(camel(e.code))}${detailsType ? `(${detailsType})` : ""}`);
    }
    out.push(
      "",
      `${e2}${access}static let codes = [${action.errors.map((e) => JSON.stringify(e.code)).join(", ")}]`,
      "",
      `${e2}${access}init(code: String, details: JSONValue?) throws {`,
      `${e3}switch code {`,
    );
    for (const e of action.errors) {
      const c = ident(camel(e.code));
      const value = e.details
        ? `.${c}(try (details ?? .null).decode(${e.path[e.path.length - 1]}.self))`
        : `.${c}`;
      out.push(`${e3}case ${JSON.stringify(e.code)}: self = ${value}`);
    }
    out.push(
      `${e3}default: throw ActionFailure(status: 200, code: code, body: Data())`,
      `${e3}}`,
      `${e2}}`,
      "",
      `${e2}${access}var code: String {`,
      `${e3}switch self {`,
    );
    for (const e of action.errors) {
      out.push(`${e3}case .${ident(camel(e.code))}: return ${JSON.stringify(e.code)}`);
    }
    out.push(
      `${e3}}`,
      `${e2}}`,
      "",
      `${e2}${access}var details: JSONValue? {`,
      `${e3}switch self {`,
    );
    for (const e of action.errors) {
      const c = ident(camel(e.code));
      out.push(
        e.details
          ? `${e3}case .${c}(let details): return try? JSONValue(encoding: details)`
          : `${e3}case .${c}: return nil`,
      );
    }
    out.push(`${e3}}`, `${e2}}`, `${inner}}`);
    for (const e of action.errors) {
      if (!e.details) {
        continue;
      }
      out.push("");
      emitObject(e.details, inner, undefined, `The details of ${JSON.stringify(e.code)}.`);
    }
    out.push("}");
  };

  const emitField = (f: Field, indent: string) => {
    doc(indent, f.description);
    out.push(
      `${indent}${access}let ${ident(camel(f.jsonName))}: ${typeName(f.type)}${f.required ? "" : "?"}`,
    );
  };

  islands.forEach((island, i) => {
    if (i > 0) {
      out.push("");
    }
    emitObject(island.props, "", island);
  });
  for (const action of actions) {
    out.push("");
    emitAction(action);
  }
  return `${out.join("\n")}\n`;
}
