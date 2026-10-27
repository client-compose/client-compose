// Strings (spec §4.7): the words a client shows, from the composer. Templates are filled in here,
// counted strings pick their variant by the language's plural rules, and an island's strings
// become the typed `t` its renderer receives.

import {
  type AppStringsDescriptor,
  buildStrings,
  type ClientContext,
  PROTOCOL_VERSION,
  type StringsResponse,
} from "@client-compose/protocol";

// Shared with composers; re-exported so apps need only this package.
export {
  buildStrings,
  formatString,
  pluralCategory,
  type StringValues,
} from "@client-compose/protocol";

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
