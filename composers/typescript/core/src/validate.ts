// Validates action input against its JSON Schema: the subset codegen accepts (codegen/README.md).

interface Schema {
  type: "object" | "array" | "string" | "integer" | "number" | "boolean";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: Schema;
  items?: Schema;
  enum?: string[];
  format?: string;
}

export type Validation = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * Checks `value` against `schema` (spec §5.2): unknown properties are ignored and a null optional
 * property counts as absent. On success, `value` is a copy with those nulls removed, so handlers
 * see what their types say.
 */
export function validate(schema: Record<string, unknown>, value: unknown, path = "input"): Validation {
  try {
    return { ok: true, value: check(schema as unknown as Schema, value, path) };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, message: err.message };
    throw err;
  }
}

class Invalid extends Error {}

const INT32 = 2 ** 31;

function check(s: Schema, v: unknown, path: string): unknown {
  const fail = (expected: string): never => {
    throw new Invalid(`${path}: expected ${expected}`);
  };
  switch (s.type) {
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return fail("an object");
      const obj = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      if (s.additionalProperties) {
        for (const [k, item] of Object.entries(obj)) out[k] = check(s.additionalProperties, item, `${path}.${k}`);
        return out;
      }
      for (const name of s.required ?? []) {
        if (obj[name] === undefined || obj[name] === null) throw new Invalid(`${path}.${name}: required`);
      }
      for (const [k, item] of Object.entries(obj)) {
        const prop = s.properties?.[k];
        if (!prop) out[k] = item; // unknown: ignored, but passed through untouched
        else if (item !== null && item !== undefined) out[k] = check(prop, item, `${path}.${k}`);
      }
      return out;
    }
    case "array":
      if (!Array.isArray(v)) return fail("an array");
      return v.map((item, i) => check(s.items!, item, `${path}[${i}]`));
    case "string":
      if (typeof v !== "string") return fail("a string");
      if (s.enum && !s.enum.includes(v)) return fail(`one of ${s.enum.join(", ")}`);
      if (s.format === "uri" && !isAbsoluteUri(v)) return fail("an absolute URI");
      return v;
    case "integer": {
      const int64 = s.format === "int64";
      if (typeof v !== "number" || !Number.isInteger(v) || (!int64 && (v >= INT32 || v < -INT32))) {
        return fail(`an integer that fits ${int64 ? "int64" : "int32"}`);
      }
      return v;
    }
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return fail("a number");
      return v;
    case "boolean":
      if (typeof v !== "boolean") return fail("a boolean");
      return v;
  }
  throw new Invalid(`${path}: unsupported schema type ${JSON.stringify((s as { type: unknown }).type)}`);
}

function isAbsoluteUri(v: string): boolean {
  try {
    return new URL(v).protocol.length > 1;
  } catch {
    return false;
  }
}
