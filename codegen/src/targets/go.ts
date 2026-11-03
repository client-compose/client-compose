import { spawnSync } from "node:child_process";

import { emit, type Model, type Role, type Target } from "../emit.ts";
import {
  type Action,
  type Entity,
  type Island,
  islandEntityPaths,
  type ObjectDef,
  type ScreenStringsDef,
  type SharedType,
  type TypeRef,
  words,
} from "../manifest.ts";

export interface GoOptions {
  package: string;
}

// https://go.dev/wiki/CodeReviewComments#initialisms
const INITIALISMS = new Set(
  "acl api ascii cpu css dns eof guid html http https id ip json lhs qps ram rhs rpc sla smtp sql ssh tcp tls ttl udp ui uid uuid uri url utf8 vm xml xmpp xsrf xss".split(
    " ",
  ),
);

const goName = (s: string) =>
  words(s)
    .map((w) => (INITIALISMS.has(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join("") || "X";

const typeIdent = (path: string[]) => path.map(goName).join("");

/** A param as a Go parameter: lower camel case, clear of Go's keywords. */
const goParam = (p: string) => {
  const name = goName(p).replace(/^[A-Z]+(?=[A-Z][a-z]|$)|^[A-Z]/, (m) => m.toLowerCase());
  return GO_KEYWORDS.has(name) ? `${name}_` : name;
};

const GO_KEYWORDS = new Set(
  "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var".split(
    " ",
  ),
);

export function generateGo(
  islands: Island[],
  header: string,
  opts: GoOptions,
  actions: Action[] = [],
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
      header,
    },
    go(opts),
  );
}

/** Doc comment lines. */
function doc(indent: string, text?: string): string[] {
  return text ? text.split("\n").map((line) => `${indent}// ${line}`) : [];
}

function typeName(t: TypeRef): string {
  switch (t.kind) {
    case "string":
      return "string";
    case "integer":
      return t.int64 ? "int64" : "int";
    case "number":
      return "float64";
    case "boolean":
      return "bool";
    case "array":
      return `[]${typeName(t.items)}`;
    case "map":
      return `map[string]${typeName(t.values)}`;
    case "object":
    case "enum":
      return typeIdent(t.def.path);
  }
}

/** A struct for an object type, after its comment lines. */
function struct(def: ObjectDef, comments: string[], description: string | undefined): string[] {
  const name = typeIdent(def.path);
  const out = ["", ...comments.map((c) => `// ${name} ${c}`), ...doc("", description)];
  out.push(`type ${name} struct${def.fields.length ? " {" : "{}"}`);
  for (const f of def.fields) {
    // Optional scalars and objects are pointers so "absent" differs from the zero value;
    // optional slices and maps use nil for absent.
    const base = typeName(f.type);
    const pointer = !f.required && f.type.kind !== "array" && f.type.kind !== "map";
    const tag = `json:"${f.jsonName}${f.required ? "" : ",omitempty"}"`;
    out.push(
      ...doc("\t", f.description),
      `\t${goName(f.jsonName)} ${pointer ? "*" : ""}${base} \`${tag}\``,
    );
  }
  if (def.fields.length) {
    out.push("}");
  }
  return out;
}

/** An island's props struct, and the methods that make it one. */
function island(def: ObjectDef, role: Extract<Role, { kind: "island" }>): string[] {
  const { island: i, entityPaths: paths } = role;
  const name = typeIdent(def.path);
  const out = [
    ...struct(
      def,
      [`holds the props of island ${JSON.stringify(i.type)} v${i.version}.`],
      i.description ?? def.description,
    ),
    "",
    `func (${name}) IslandType() string { return ${JSON.stringify(i.type)} }`,
    "",
    `func (${name}) IslandVersion() int { return ${i.version} }`,
  ];
  if (paths.length > 0) {
    const quoted = (list: string[]) => list.map((v) => JSON.stringify(v)).join(", ");
    out.push(
      "",
      "// IslandEntities says where its props hold entities (spec §2.1), so changes reach them.",
      `func (${name}) IslandEntities() []cc.EntityPath {`,
      "\treturn []cc.EntityPath{",
      ...paths.map(
        (p) =>
          `\t\t{Path: []string{${quoted(p.path)}}, Entity: ${JSON.stringify(p.entity)}, ID: ${JSON.stringify(p.id)}, Properties: []string{${quoted(p.properties)}}},`,
      ),
      "\t}",
      "}",
    );
  }
  return out;
}

/** An action's input struct, and the methods that tie it to the action. */
function input(def: ObjectDef, action: Action): string[] {
  const name = typeIdent(def.path);
  const result = typeIdent(action.result.path);
  return [
    ...struct(def, [`is the input of ${label(action)}.`], action.description),
    "",
    `func (${name}) ActionName() string { return ${JSON.stringify(action.action)} }`,
    "",
    `func (${name}) ActionVersion() int { return ${action.version} }`,
    "",
    "// ActionInputSchema is the JSON Schema the composer validates requests against.",
    `func (${name}) ActionInputSchema() string { return ${JSON.stringify(JSON.stringify(action.inputSchema))} }`,
    "",
    "// ActionErrorCodes lists the action's declared errors.",
    `func (${name}) ActionErrorCodes() []string { return []string{${action.errors.map((e) => JSON.stringify(e.code)).join(", ")}} }`,
    "",
    `// ActionResult ties the input to its result type, ${result}.`,
    `func (${name}) ActionResult(${result}) {}`,
  ];
}

/** The methods that make a declared error's type one: its code, its action, its details. */
function errorMethods(def: ObjectDef, role: Extract<Role, { kind: "error" }>): string[] {
  const { action, error } = role;
  const name = typeIdent(def.path);
  return [
    "",
    `func (${name}) ActionErrorCode() string { return ${JSON.stringify(error.code)} }`,
    "",
    `// ActionErrorOf names the action version that declares this error.`,
    `func (${name}) ActionErrorOf() (string, int) { return ${JSON.stringify(action.action)}, ${action.version} }`,
    "",
    error.details
      ? `func (e ${name}) ActionErrorDetails() any { return e }`
      : `func (${name}) ActionErrorDetails() any { return nil }`,
    "",
    `func (${name}) Error() string { return ${JSON.stringify(`${action.action} v${action.version}: ${error.code}`)} }`,
  ];
}

const label = (action: Action) => `action ${JSON.stringify(action.action)} v${action.version}`;

/** A screen's own strings: a struct of its table, with a method for each string. */
function screenStrings(s: ScreenStringsDef): string[] {
  const name = `${goName(s.screen)}ScreenStrings`;
  const out = [
    "",
    `// ${name} are the ${s.screen} screen's own strings, in the request's language (spec §4.7).`,
    `type ${name} struct{ table cc.StringsTable }`,
    "",
    `// ${name}For reads them from a layout's, resolver's or meta's request, or an action's call.`,
    `func ${name}For(r cc.ScreenStringsSource) ${name} { return ${name}{r.ScreenStrings(${JSON.stringify(s.screen)})} }`,
  ];
  for (const d of s.strings) {
    out.push("", ...doc("", d.description));
    const method = goName(d.key);
    if (d.params.length === 0) {
      out.push(
        `func (s ${name}) ${method}() string { return s.table.Text(${JSON.stringify(d.key)}) }`,
      );
      continue;
    }
    const args = d.params.map((p) => `${goParam(p)} ${p === "count" ? "int" : "string"}`);
    const values = d.params.map(
      (p) => `${JSON.stringify(p)}: ${p === "count" ? `strconv.Itoa(${goParam(p)})` : goParam(p)}`,
    );
    out.push(
      `func (s ${name}) ${method}(${args.join(", ")}) string {`,
      `\treturn s.table.Format(${JSON.stringify(d.key)}, map[string]string{${values.join(", ")}})`,
      "}",
    );
  }
  return out;
}

/** Go: structs, string types with constants, and the methods composers use to tell them apart. */
export function go(opts: GoOptions): Target {
  return {
    prelude: (model: Model) => {
      const out = [model.header.replace(/^/gm, "// "), "", `package ${opts.package}`];
      const holdsEntities = model.islands.some(
        (i) => islandEntityPaths(i, model.entities).length > 0,
      );
      if (model.screens.length > 0 || holdsEntities) {
        const counted = model.screens.some((s) =>
          s.strings.some((d) => d.params.includes("count")),
        );
        out.push(
          "",
          "import (",
          ...(counted ? [`\t"strconv"`, ""] : []),
          `\tcc "github.com/client-compose/client-compose/composers/go/core"`,
          ")",
        );
      }
      return out;
    },
    screenStrings,
    enumeration: (def) => {
      const name = typeIdent(def.path);
      return [
        "",
        ...doc("", def.description),
        `type ${name} string`,
        "",
        "const (",
        ...def.values.map((v) => `\t${name}${goName(v)} ${name} = ${JSON.stringify(v)}`),
        ")",
      ];
    },
    object: (def, role) => {
      switch (role.kind) {
        case "island":
          return island(def, role);
        case "input":
          return input(def, role.action);
        case "result":
          return struct(def, [`is the result of ${label(role.action)}.`], def.description);
        case "error":
          return struct(
            def,
            [`is the declared error ${JSON.stringify(role.error.code)} of ${label(role.action)}.`],
            role.error.description,
          );
        case "entity":
          return struct(
            def,
            [
              `is a change to entity ${JSON.stringify(role.entity.entity)} (spec §2.1): what an action sets, each property absent unless it changed.`,
            ],
            def.description,
          );
        case "shared":
          return struct(
            def,
            [
              `is shared type ${JSON.stringify(role.type.name)} (spec §2.2): every manifest that refers to it uses this.`,
            ],
            def.description,
          );
        case "nested":
          return struct(def, [], def.description);
      }
    },
    afterChildren: (def, role) => {
      if (role.kind === "error") {
        return errorMethods(def, role);
      }
      if (role.kind === "entity") {
        return [
          "",
          `func (${typeIdent(def.path)}) EntityName() string { return ${JSON.stringify(role.entity.entity)} }`,
        ];
      }
      return [];
    },
    finish: gofmt,
  };
}

/** Align fields the way gofmt does. Go developers have gofmt; if it's missing, output is still valid Go. */
function gofmt(src: string): string {
  const res = spawnSync("gofmt", [], { input: src, encoding: "utf8" });
  if (res.error || res.status !== 0) {
    if (res.status) {
      throw new Error(`gofmt rejected generated code:\n${res.stderr}`);
    }
    console.warn("codegen: gofmt not found on PATH; Go output is unformatted");
    return src;
  }
  return res.stdout;
}
