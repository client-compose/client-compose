import { camel, words, type EnumDef, type Field, type Island, type ObjectDef, type TypeRef } from "../manifest.ts";

export interface KotlinOptions {
  package: string;
}

const RESERVED = new Set(
  ("as break class continue do else false for fun if in interface is null object package return super this throw " +
    "true try typealias typeof val var when while").split(" "),
);

const ident = (name: string) => (RESERVED.has(name) ? `\`${name}\`` : name);
const constant = (value: string) => {
  const c = words(value).join("_").toUpperCase() || "VALUE";
  return /^[0-9]/.test(c) ? `_${c}` : c;
};

export function generateKotlin(islands: Island[], header: string, opts: KotlinOptions): string {
  const body: string[] = [];
  let usesSerialName = false;

  const doc = (indent: string, text?: string) => {
    if (!text) return;
    const lines = text.split("\n");
    if (lines.length === 1) body.push(`${indent}/** ${lines[0]} */`);
    else body.push(`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`);
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
    for (const v of def.values) body.push(`${indent}    @SerialName(${JSON.stringify(v)}) ${constant(v)},`);
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

  const emitObject = (def: ObjectDef, indent: string, island?: Island) => {
    const name = island ? def.path.join("") : def.path[def.path.length - 1];
    doc(indent, island?.description ?? def.description);
    body.push(`${indent}@Serializable`);
    const head = def.fields.length ? `${indent}data class ${name}(` : `${indent}class ${name}`;
    const inner = indent + "    ";
    const hasBody = island || def.children.length > 0;
    if (def.fields.length) {
      body.push(head);
      for (const f of def.fields) emitField(f, inner);
      body.push(`${indent})${hasBody ? " {" : ""}`);
    } else {
      body.push(head + (hasBody ? " {" : ""));
    }
    if (!hasBody) return;
    def.children.forEach((child, i) => {
      if (i > 0) body.push("");
      child.kind === "enum" ? emitEnum(child, inner) : emitObject(child, inner);
    });
    if (island) {
      if (def.children.length) body.push("");
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

  islands.forEach((island, i) => {
    if (i > 0) body.push("");
    emitObject(island.props, "", island);
  });

  const imports = [
    "dev.clientcompose.IslandDescriptor",
    "kotlinx.serialization.KSerializer",
    ...(usesSerialName ? ["kotlinx.serialization.SerialName"] : []),
    "kotlinx.serialization.Serializable",
  ];
  return [
    header.replace(/^/gm, "// "),
    "",
    `package ${opts.package}`,
    "",
    ...imports.map((i) => `import ${i}`),
    "",
    ...body,
  ].join("\n") + "\n";
}
