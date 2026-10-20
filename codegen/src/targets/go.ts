import { spawnSync } from "node:child_process";
import { words, type Action, type EnumDef, type Island, type ObjectDef, type TypeRef } from "../manifest.ts";

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

export function generateGo(islands: Island[], header: string, opts: GoOptions, actions: Action[] = []): string {
  const out: string[] = [header.replace(/^/gm, "// "), "", `package ${opts.package}`];

  const doc = (indent: string, text?: string) => {
    if (text) for (const line of text.split("\n")) out.push(`${indent}// ${line}`);
  };

  const typeName = (t: TypeRef): string => {
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
  };

  const emitEnum = (def: EnumDef) => {
    const name = typeIdent(def.path);
    out.push("");
    doc("", def.description);
    out.push(`type ${name} string`, "", "const (");
    for (const v of def.values) out.push(`\t${name}${goName(v)} ${name} = ${JSON.stringify(v)}`);
    out.push(")");
  };

  const emitObject = (def: ObjectDef, island?: Island, intro?: string) => {
    const name = typeIdent(def.path);
    out.push("");
    if (island) out.push(`// ${name} holds the props of island ${JSON.stringify(island.type)} v${island.version}.`);
    if (intro) out.push(`// ${name} ${intro}`);
    doc("", island?.description ?? def.description);
    out.push(`type ${name} struct${def.fields.length ? " {" : "{}"}`);
    for (const f of def.fields) {
      doc("\t", f.description);
      // Optional scalars and objects are pointers so "absent" differs from the zero value;
      // optional slices and maps use nil for absent.
      const base = typeName(f.type);
      const pointer = !f.required && f.type.kind !== "array" && f.type.kind !== "map";
      const tag = `json:"${f.jsonName}${f.required ? "" : ",omitempty"}"`;
      out.push(`\t${goName(f.jsonName)} ${pointer ? "*" : ""}${base} \`${tag}\``);
    }
    if (def.fields.length) out.push("}");
    if (island) {
      out.push(
        "",
        `func (${name}) IslandType() string { return ${JSON.stringify(island.type)} }`,
        "",
        `func (${name}) IslandVersion() int { return ${island.version} }`,
      );
    }
    for (const child of def.children) child.kind === "enum" ? emitEnum(child) : emitObject(child);
  };

  const emitAction = (action: Action) => {
    const label = `action ${JSON.stringify(action.action)} v${action.version}`;
    const input = typeIdent(action.input.path);
    const result = typeIdent(action.result.path);
    emitObject({ ...action.input, children: [], description: action.description }, undefined, `is the input of ${label}.`);
    out.push(
      "",
      `func (${input}) ActionName() string { return ${JSON.stringify(action.action)} }`,
      "",
      `func (${input}) ActionVersion() int { return ${action.version} }`,
      "",
      "// ActionInputSchema is the JSON Schema the composer validates requests against.",
      `func (${input}) ActionInputSchema() string { return ${JSON.stringify(JSON.stringify(action.inputSchema))} }`,
      "",
      "// ActionErrorCodes lists the action's declared errors.",
      `func (${input}) ActionErrorCodes() []string { return []string{${action.errors.map((e) => JSON.stringify(e.code)).join(", ")}} }`,
      "",
      `// ActionResult ties the input to its result type, ${result}.`,
      `func (${input}) ActionResult(${result}) {}`,
    );
    for (const child of action.input.children) child.kind === "enum" ? emitEnum(child) : emitObject(child);
    emitObject(action.result, undefined, `is the result of ${label}.`);
    for (const e of action.errors) {
      const name = typeIdent(e.path);
      const details: ObjectDef = e.details ?? { kind: "object", path: e.path, fields: [], children: [] };
      emitObject({ ...details, description: e.description }, undefined, `is the declared error ${JSON.stringify(e.code)} of ${label}.`);
      out.push(
        "",
        `func (${name}) ActionErrorCode() string { return ${JSON.stringify(e.code)} }`,
        "",
        `// ActionErrorOf names the action version that declares this error.`,
        `func (${name}) ActionErrorOf() (string, int) { return ${JSON.stringify(action.action)}, ${action.version} }`,
        "",
        e.details
          ? `func (e ${name}) ActionErrorDetails() any { return e }`
          : `func (${name}) ActionErrorDetails() any { return nil }`,
        "",
        `func (${name}) Error() string { return ${JSON.stringify(`${action.action} v${action.version}: ${e.code}`)} }`,
      );
    }
  };

  for (const island of islands) emitObject(island.props, island);
  for (const action of actions) emitAction(action);
  return gofmt(out.join("\n") + "\n");
}

/** Align fields the way gofmt does. Go developers have gofmt; if it's missing, output is still valid Go. */
function gofmt(src: string): string {
  const res = spawnSync("gofmt", [], { input: src, encoding: "utf8" });
  if (res.error || res.status !== 0) {
    if (res.status) throw new Error(`gofmt rejected generated code:\n${res.stderr}`);
    console.warn("codegen: gofmt not found on PATH; Go output is unformatted");
    return src;
  }
  return res.stdout;
}
