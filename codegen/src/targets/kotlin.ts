import {
  type Action,
  camel,
  type EnumDef,
  type Field,
  type Island,
  type ObjectDef,
  type TypeRef,
  words,
} from "../manifest.ts";

export interface KotlinOptions {
  package: string;
}

const RESERVED = new Set(
  (
    "as break class continue do else false for fun if in interface is null object package return super this throw " +
    "true try typealias typeof val var when while"
  ).split(" "),
);

const ident = (name: string) => (RESERVED.has(name) ? `\`${name}\`` : name);
const constant = (value: string) => {
  const c = words(value).join("_").toUpperCase() || "VALUE";
  return /^[0-9]/.test(c) ? `_${c}` : c;
};

const pascalCase = (code: string) => camel(code).replace(/^./, (c) => c.toUpperCase());

export function generateKotlin(
  islands: Island[],
  header: string,
  opts: KotlinOptions,
  actions: Action[] = [],
): string {
  const body: string[] = [];
  let usesSerialName = false;

  const doc = (indent: string, text?: string) => {
    if (!text) {
      return;
    }
    const lines = text.split("\n");
    if (lines.length === 1) {
      body.push(`${indent}/** ${lines[0]} */`);
    } else {
      body.push(`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`);
    }
  };

  const typeName = (t: TypeRef): string => {
    switch (t.kind) {
      case "string":
        return "String";
      case "integer":
        return t.int64 ? "Long" : "Int";
      case "number":
        return "Double";
      case "boolean":
        return "Boolean";
      case "array":
        return `List<${typeName(t.items)}>`;
      case "map":
        return `Map<String, ${typeName(t.values)}>`;
      case "object":
      case "enum":
        return t.def.path[t.def.path.length - 1];
    }
  };

  const emitEnum = (def: EnumDef, indent: string) => {
    doc(indent, def.description);
    usesSerialName = true;
    body.push(`${indent}@Serializable`, `${indent}enum class ${def.path[def.path.length - 1]} {`);
    for (const v of def.values) {
      body.push(`${indent}    @SerialName(${JSON.stringify(v)}) ${constant(v)},`);
    }
    body.push(`${indent}}`);
  };

  const emitField = (f: Field, indent: string) => {
    doc(indent, f.description);
    const name = camel(f.jsonName);
    let annotation = "";
    if (name !== f.jsonName) {
      usesSerialName = true;
      annotation = `@SerialName(${JSON.stringify(f.jsonName)}) `;
    }
    const type = typeName(f.type) + (f.required ? "" : "? = null");
    body.push(`${indent}${annotation}val ${ident(name)}: ${type},`);
  };

  const emitObject = (def: ObjectDef, indent: string, island?: Island, description?: string) => {
    const name = island ? def.path.join("") : def.path[def.path.length - 1];
    doc(indent, island?.description ?? description ?? def.description);
    body.push(`${indent}@Serializable`);
    const head = def.fields.length ? `${indent}data class ${name}(` : `${indent}class ${name}`;
    const inner = `${indent}    `;
    const hasBody = island || def.children.length > 0;
    if (def.fields.length) {
      body.push(head);
      for (const f of def.fields) {
        emitField(f, inner);
      }
      body.push(`${indent})${hasBody ? " {" : ""}`);
    } else {
      body.push(head + (hasBody ? " {" : ""));
    }
    if (!hasBody) {
      return;
    }
    def.children.forEach((child, i) => {
      if (i > 0) {
        body.push("");
      }
      if (child.kind === "enum") {
        emitEnum(child, inner);
      } else {
        emitObject(child, inner);
      }
    });
    if (island) {
      if (def.children.length) {
        body.push("");
      }
      body.push(
        `${inner}companion object : IslandDescriptor<${name}> {`,
        `${inner}    override val type: String = ${JSON.stringify(island.type)}`,
        `${inner}    override val version: Int = ${island.version}`,
        `${inner}    override val propsSerializer: KSerializer<${name}> get() = serializer()`,
        `${inner}}`,
      );
    }
    body.push(`${indent}}`);
  };

  const emitAction = (action: Action) => {
    const name = action.input.path.slice(0, -1).join("");
    const label = `${JSON.stringify(action.action)} v${action.version}`;
    const errorType = action.errors.length ? "Error" : "Nothing";
    const i = "    ";
    doc("", action.description);
    body.push(
      `object ${name} : ActionDescriptor<${name}.Input, ${name}.Result, ${action.errors.length ? `${name}.Error` : "Nothing"}> {`,
      `${i}override val action: String = ${JSON.stringify(action.action)}`,
      `${i}override val version: Int = ${action.version}`,
      `${i}override val inputSerializer: KSerializer<Input> get() = Input.serializer()`,
      `${i}override val resultSerializer: KSerializer<Result> get() = Result.serializer()`,
      `${i}override val errorCodes: List<String> = listOf(${action.errors.map((e) => JSON.stringify(e.code)).join(", ")})`,
      "",
    );
    if (action.errors.length === 0) {
      body.push(
        `${i}override fun decodeError(code: String, details: JsonElement?, json: Json): Nothing =`,
        `${i}    throw IllegalArgumentException("${action.action} v${action.version} declares no errors, got $code")`,
        "",
        `${i}override fun encodeErrorDetails(error: Nothing, json: Json): JsonElement? = null`,
      );
    } else {
      const sub = (code: string) => `Error.${pascalCase(code)}`;
      body.push(
        `${i}override fun decodeError(code: String, details: JsonElement?, json: Json): Error = when (code) {`,
      );
      for (const e of action.errors) {
        const value = e.details
          ? `${sub(e.code)}(json.decodeFromJsonElement(${name}.${e.path[e.path.length - 1]}.serializer(), details ?: JsonNull))`
          : sub(e.code);
        body.push(`${i}    ${JSON.stringify(e.code)} -> ${value}`);
      }
      body.push(
        `${i}    else -> throw IllegalArgumentException("${action.action} v${action.version} doesn't declare $code")`,
        `${i}}`,
        "",
        `${i}override fun encodeErrorDetails(error: Error, json: Json): JsonElement? = when (error) {`,
      );
      for (const e of action.errors) {
        body.push(
          e.details
            ? `${i}    is ${sub(e.code)} -> json.encodeToJsonElement(${name}.${e.path[e.path.length - 1]}.serializer(), error.details)`
            : `${i}    ${sub(e.code)} -> null`,
        );
      }
      body.push(`${i}}`);
    }
    body.push("");
    emitObject(action.input, i, undefined, `The input of ${label}.`);
    body.push("");
    emitObject(action.result, i, undefined, `The result of ${label}.`);
    if (action.errors.length) {
      body.push(
        "",
        `${i}/**`,
        `${i} * The errors ${label} declares. A newer composer may send codes this app doesn't know:`,
        `${i} * \`ComposeClient.perform\` throws those as \`ActionFailure\`.`,
        `${i} */`,
        `${i}sealed interface ${errorType} : DeclaredError {`,
      );
      action.errors.forEach((e, n) => {
        if (n > 0) {
          body.push("");
        }
        doc(`${i}    `, e.description);
        const cls = pascalCase(e.code);
        body.push(
          e.details
            ? `${i}    data class ${cls}(val details: ${name}.${e.path[e.path.length - 1]}) : Error {`
            : `${i}    data object ${cls} : Error {`,
          `${i}        override val code: String get() = ${JSON.stringify(e.code)}`,
          `${i}    }`,
        );
      });
      body.push(`${i}}`);
      for (const e of action.errors) {
        if (!e.details) {
          continue;
        }
        body.push("");
        emitObject(e.details, i, undefined, `The details of ${JSON.stringify(e.code)}.`);
      }
    }
    body.push("}");
  };

  islands.forEach((island, i) => {
    if (i > 0) {
      body.push("");
    }
    emitObject(island.props, "", island);
  });
  for (const action of actions) {
    body.push("");
    emitAction(action);
  }

  const imports = [
    ...(actions.length ? ["dev.clientcompose.ActionDescriptor"] : []),
    ...(actions.some((a) => a.errors.length) ? ["dev.clientcompose.DeclaredError"] : []),
    ...(islands.length ? ["dev.clientcompose.IslandDescriptor"] : []),
    "kotlinx.serialization.KSerializer",
    ...(usesSerialName ? ["kotlinx.serialization.SerialName"] : []),
    "kotlinx.serialization.Serializable",
    ...(actions.length
      ? ["kotlinx.serialization.json.Json", "kotlinx.serialization.json.JsonElement"]
      : []),
    ...(actions.some((a) => a.errors.some((e) => e.details))
      ? ["kotlinx.serialization.json.JsonNull"]
      : []),
  ];
  return `${[
    header.replace(/^/gm, "// "),
    "",
    `package ${opts.package}`,
    "",
    ...imports.map((i) => `import ${i}`),
    "",
    ...body,
  ].join("\n")}\n`;
}
