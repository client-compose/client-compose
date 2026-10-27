// Strings (spec §4.7): the words a client shows, from the composer. Templates are filled in here,
// counted strings pick their variant by the language's plural rules, and an island's strings
// become the typed `t` its renderer receives.

import {
  type AppStringsDescriptor,
  type ClientContext,
  type PluralRules,
  PROTOCOL_VERSION,
  type StringParams,
  type Strings,
  type StringsResponse,
  type StringTemplate,
} from "@client-compose/protocol";

// ---- Plural rules ----

/** A count's plural category in a language: the first whose condition holds, or "other". */
export function pluralCategory(rules: PluralRules | undefined, count: number): string {
  for (const [category, condition] of Object.entries(rules ?? {})) {
    if (condition !== undefined && holds(condition, count)) {
      return category;
    }
  }
  return "other";
}

/**
 * Whether a CLDR plural condition holds for a whole number: `or` of `and`s of relations like
 * `i % 10 = 2..4` or `v = 0`. For a whole number, `n` and `i` are the number, and `v`, `w`, `f`,
 * `t`, `c` and `e` are zero.
 */
function holds(condition: string, count: number): boolean {
  return condition.split(" or ").some((all) => all.split(" and ").every((r) => relates(r, count)));
}

const RELATION = /^\s*([nivwftce])\s*(?:%\s*(\d+))?\s*(!=|=)\s*(.+?)\s*$/;

function relates(relation: string, count: number): boolean {
  const match = RELATION.exec(relation);
  if (!match) {
    return false;
  }
  const [, operand = "", modulus, op, ranges = ""] = match;
  const base = operand === "n" || operand === "i" ? Math.abs(Math.trunc(count)) : 0;
  const value = modulus === undefined ? base : base % Number(modulus);
  const inRanges = ranges.split(",").some((range) => {
    const [from = "", to] = range.trim().split("..");
    return to === undefined ? value === Number(from) : value >= Number(from) && value <= Number(to);
  });
  return op === "=" ? inRanges : !inRanges;
}

// ---- Templates ----

/** The values a string's params take. A counted string's `count` picks its variant. */
export type StringValues = Record<string, string | number>;

/**
 * A string's words with its params filled in. Variants are chosen by the exact count, then its
 * plural category, then `#*`.
 */
export function formatString(
  template: StringTemplate | undefined,
  values: StringValues = {},
  plurals?: PluralRules,
): string {
  if (template === undefined) {
    return "";
  }
  const text = typeof template === "string" ? template : variant(template, values.count, plurals);
  return text.replace(/\{([A-Za-z0-9]+)\}/g, (slot, name: string) =>
    name in values ? String(values[name]) : slot,
  );
}

function variant(
  variants: Record<string, string>,
  count: string | number | undefined,
  plurals: PluralRules | undefined,
): string {
  const n = Number(count);
  if (Number.isFinite(n)) {
    const exact = variants[`#${n}`];
    if (exact !== undefined) {
      return exact;
    }
    const category = variants[`#${pluralCategory(plurals, n)}`];
    if (category !== undefined) {
      return category;
    }
  }
  return variants["#*"] ?? "";
}

/**
 * Strings as a renderer receives them: each declared string with no params as its text, each with
 * params as a function filling them in. A string the composer didn't send is empty.
 */
export function buildStrings<S>(
  declared: StringParams,
  strings: Strings | undefined,
  plurals: PluralRules | undefined,
): S {
  const t: Record<string, string | ((values: StringValues) => string)> = {};
  for (const [key, params] of Object.entries(declared)) {
    const template = strings?.[key];
    t[key] =
      params.length === 0
        ? formatString(template, {}, plurals)
        : (values: StringValues) => formatString(template, values, plurals);
  }
  // The declared keys and params are the ones codegen typed S with.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return t as S;
}

// ---- App strings ----

/** The app strings, typed by their generated descriptor: `appStrings(AppStrings, response).retry`. */
export function appStrings<S>(descriptor: AppStringsDescriptor<S>, response: StringsResponse): S {
  return buildStrings<S>(descriptor.strings, response.strings, response.plurals);
}

/** Thrown for a strings request the composer didn't answer with 200 and its strings. */
export class StringsFetchError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Strings request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isStringsResponse(value: unknown): value is StringsResponse {
  if (!isRecord(value) || typeof value.locale !== "string") {
    return false;
  }
  return isRecord(value.plurals) && isRecord(value.strings);
}

/** Fetch the app strings in the client's language (spec §4.7). */
export async function fetchStrings(
  baseUrl: string,
  client: ClientContext,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<StringsResponse> {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetchImpl(`${baseUrl}/strings`, {
    ...init,
    method: "POST",
    headers,
    body: JSON.stringify({ protocol: PROTOCOL_VERSION, client }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new StringsFetchError(res.status, text);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StringsFetchError(res.status, text);
  }
  if (!isStringsResponse(parsed)) {
    throw new StringsFetchError(res.status, text);
  }
  return parsed;
}
