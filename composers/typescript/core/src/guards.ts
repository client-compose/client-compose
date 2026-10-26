// Type guards for values from outside the composer's types: request bodies and other JSON.

/** A JSON object: not null, and not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
