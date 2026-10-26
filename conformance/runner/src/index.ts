import { existsSync, readFileSync } from "node:fs";

export interface ComposerCase {
  name: string;
  placements: {
    key: string;
    type: string;
    versions: number[];
    outcome: "ok" | "error" | "timeout";
    required?: boolean;
    timeoutMs?: number;
    /** The island has this many pages (spec §4.5). */
    pages?: number;
    /** It waits this long before it resolves or fails. */
    startDelayMs?: number;
  }[];
  capabilities: Record<string, number[]>;
  request?: Record<string, unknown>;
  path?: string;
  rawBody?: string;
  expect: ScreenExpectation;
}

/**
 * What a screen case expects. For a 200, `body` is matched against the stream put together, and
 * `pending` and `resolved` list keys that must be pending, or not, in its head (spec §4.6).
 */
export interface ScreenExpectation {
  status: number;
  body?: unknown;
  pending?: string[];
  resolved?: string[];
}

/** An island request (spec §4.5) for the `__conformance` screen laid out with `placements`. */
export interface IslandCase {
  name: string;
  placements: ComposerCase["placements"];
  key: string;
  version: number;
  cursor?: string;
  /** Overrides for the request body (protocol, screen, params, client...). */
  request?: Record<string, unknown>;
  /** The screen in the path. Default: the request's. */
  path?: string;
  /** The key in the path. Default: the request's. */
  pathKey?: string;
  rawBody?: string;
  expect: { status: number; body?: unknown };
}

export interface ActionCase {
  name: string;
  /** The conformance action's input. Default: { "outcome": "ok", "echo": "hi" }. */
  input?: unknown;
  /** Overrides for the request body (protocol, action, version, client, idempotencyKey...). */
  request?: Record<string, unknown>;
  path?: string;
  rawBody?: string;
  expect: { status: number; body?: unknown };
}

export interface ClientCase {
  name: string;
  typedOnly?: boolean;
  registered: Record<string, number[]>;
  expectCapabilities: Record<string, number[]>;
  renderErrors?: boolean;
  response: unknown;
  expectRendered: string[];
  expectSkipped: string[];
}

/** A response a client is given: a JSON body, or a raw one sent as is. */
export interface FixtureResponse {
  status: number;
  body?: unknown;
  rawBody?: string;
}

/** Client fixtures for actions and effects (spec §5, §8.2). See the file's $comment. */
export interface ClientActionCases {
  descriptor: { action: string; version: number; errors: string[] };
  requests: {
    name: string;
    input: unknown;
    idempotencyKey: string;
    expectPath: string;
    expectBody: unknown;
  }[];
  outcomes: {
    name: string;
    response: FixtureResponse;
    expect:
      | { outcome: "ok"; result: unknown; effects: unknown }
      | { outcome: "error"; code: string; details: unknown }
      | { outcome: "failed"; status: number; code: string | null };
  }[];
  screenRefs: {
    name: string;
    ref: { screen: string; params?: Record<string, string> };
    screen: string;
    params: Record<string, string>;
    matches: boolean;
  }[];
  screenErrors: (FixtureResponse & { name: string; expectCode: string | null })[];
}

export interface CaseResult {
  name: string;
  passed: boolean;
  message?: string;
}

const SUITES = {
  composer: "composer/cases.json",
  islands: "composer/island-cases.json",
  actions: "composer/action-cases.json",
  client: "client/cases.json",
  clientActions: "client/action-cases.json",
} as const;

/**
 * The published package carries the cases in dist/cases/ (copied at build time); in this repo
 * they're read from conformance/.
 */
function read<T>(suite: keyof typeof SUITES): T {
  const bundled = new URL(`./cases/${suite}.json`, import.meta.url);
  const inRepo = new URL(`../../${SUITES[suite]}`, import.meta.url);
  const file = existsSync(bundled) ? bundled : inRepo;
  // The suites are this package's own files, in the shapes their types describe.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

const load = <T>(suite: keyof typeof SUITES): T => read<{ cases: T }>(suite).cases;

export const composerCases = (): ComposerCase[] => load("composer");
export const islandCases = (): IslandCase[] => load("islands");
export const actionCases = (): ActionCase[] => load("actions");
export const clientCases = (): ClientCase[] => load("client");
export const clientActionCases = (): ClientActionCases => read("clientActions");

/**
 * Sends one screen case to the composer at `baseUrl`. Pass `fetchImpl` to run against a
 * fetch-standard handler in-process (e.g. `composer.fetch`) instead of a server.
 */
export async function runComposerCase(
  baseUrl: string,
  c: ComposerCase,
  fetchImpl: typeof fetch = fetch,
): Promise<CaseResult> {
  const request = {
    protocol: 0,
    screen: "__conformance",
    params: { placements: JSON.stringify(c.placements) },
    client: { platform: "conformance", appVersion: "0.0.0" },
    islands: c.capabilities,
    ...c.request,
  };
  const path = c.path ?? String(request.screen);
  try {
    const res = await fetchImpl(
      `${baseUrl.replace(/\/$/, "")}/screens/${encodeURIComponent(path)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: c.rawBody ?? JSON.stringify(request),
      },
    );
    const text = await res.text();
    if (res.status !== 200) {
      return checkResponse(c, res.status, text);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("application/jsonl")) {
      return failed(c, `expected content-type application/jsonl, got ${contentType}`);
    }
    const stream = readStream(text);
    if (typeof stream === "string") {
      return failed(c, `${stream}\n  got: ${text}`);
    }
    const mismatch = headMismatch(c.expect, stream.head) ?? bodyMismatch(c.expect, stream.screen);
    return mismatch ? failed(c, `${mismatch}\n  got: ${text}`) : { name: c.name, passed: true };
  } catch (err) {
    return failed(c, `request failed: ${String(err)}`);
  }
}

const failed = (c: { name: string }, message: string): CaseResult => ({
  name: c.name,
  passed: false,
  message,
});

/** A screen's stream (spec §4.6): its head, and the screen put together. */
export interface ReadStream {
  head: Record<string, unknown>;
  screen: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keyOf = (entry: unknown): unknown => (isRecord(entry) ? entry.key : undefined);

/**
 * Reads a stream strictly, as the suite checks it: a head first, one island line for each pending
 * island and none other, then an end, and nothing after. Returns what's wrong, if anything.
 */
export function readStream(text: string): ReadStream | string {
  const lines = text.split("\n").filter((line) => line !== "");
  const parsed: unknown[] = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      return `a line isn't JSON: ${line}`;
    }
  }
  const [head, ...rest] = parsed;
  if (!isRecord(head) || head.kind !== "head" || !Array.isArray(head.islands)) {
    return "the first line isn't a head";
  }
  const end = rest.pop();
  if (!isRecord(end) || end.kind !== "end") {
    return "the last line isn't an end";
  }
  const islands: unknown[] = [...head.islands];
  const pending = new Set(
    islands.filter((e) => isRecord(e) && e.status === "pending").map((e) => keyOf(e)),
  );
  for (const line of rest) {
    if (!isRecord(line) || line.kind !== "island" || !isRecord(line.island)) {
      return `expected an island line, got ${JSON.stringify(line)}`;
    }
    const key = line.island.key;
    if (!pending.has(key)) {
      return `an island line for ${JSON.stringify(key)}, which isn't pending`;
    }
    pending.delete(key);
    islands[islands.findIndex((e) => keyOf(e) === key)] = line.island;
  }
  if (pending.size > 0) {
    return `no line for pending ${JSON.stringify([...pending])}`;
  }
  const { kind: _kind, ...response } = head;
  return { head: response, screen: { ...response, islands } };
}

function headMismatch(
  expect: ScreenExpectation,
  head: Record<string, unknown>,
): string | undefined {
  const islands = Array.isArray(head.islands) ? head.islands : [];
  const statusOf = (key: string) =>
    islands.find((e) => keyOf(e) === key && isRecord(e) && "status" in e)?.status;
  const notPending = (expect.pending ?? []).find((key) => statusOf(key) !== "pending");
  if (notPending !== undefined) {
    return `head: expected ${notPending} to be pending`;
  }
  const isPending = (expect.resolved ?? []).find((key) => statusOf(key) === "pending");
  return isPending === undefined ? undefined : `head: expected ${isPending} to be resolved`;
}

function bodyMismatch(expect: ScreenExpectation, body: unknown): string | undefined {
  return expect.body === undefined ? undefined : subsetMismatch(expect.body, body, "body");
}

/** Sends one island case (spec §4.5). `fetchImpl` as for runComposerCase. */
export async function runIslandCase(
  baseUrl: string,
  c: IslandCase,
  fetchImpl: typeof fetch = fetch,
): Promise<CaseResult> {
  const request: Record<string, unknown> = {
    protocol: 0,
    screen: "__conformance",
    key: c.key,
    version: c.version,
    params: { placements: JSON.stringify(c.placements) },
    client: { platform: "conformance", appVersion: "0.0.0" },
    ...(c.cursor !== undefined && { cursor: c.cursor }),
    ...c.request,
  };
  const path = c.path ?? String(request.screen);
  const key = c.pathKey ?? String(request.key);
  return post(
    fetchImpl,
    `${baseUrl.replace(/\/$/, "")}/screens/${encodeURIComponent(path)}/islands/${encodeURIComponent(key)}`,
    c.rawBody ?? JSON.stringify(request),
    c,
  );
}

/** Sends one action case. `fetchImpl` as for runComposerCase. */
export async function runActionCase(
  baseUrl: string,
  c: ActionCase,
  fetchImpl: typeof fetch = fetch,
): Promise<CaseResult> {
  const request = {
    protocol: 0,
    action: "conformance",
    version: 1,
    input: c.input ?? { outcome: "ok", echo: "hi" },
    client: { platform: "conformance", appVersion: "0.0.0" },
    ...c.request,
  };
  const path = c.path ?? String(request.action);
  return post(
    fetchImpl,
    `${baseUrl.replace(/\/$/, "")}/actions/${encodeURIComponent(path)}`,
    c.rawBody ?? JSON.stringify(request),
    c,
  );
}

type JsonCase = { name: string; expect: { status: number; body?: unknown } };

async function post(
  fetchImpl: typeof fetch,
  url: string,
  body: string,
  c: JsonCase,
): Promise<CaseResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return checkResponse(c, res.status, await res.text());
  } catch (err) {
    return failed(c, `request failed: ${String(err)}`);
  }
}

/** Checks a JSON response's status and body. */
function checkResponse(c: JsonCase, status: number, text: string): CaseResult {
  if (status !== c.expect.status) {
    return failed(c, `expected status ${c.expect.status}, got ${status}: ${text}`);
  }
  if (c.expect.body === undefined) {
    return { name: c.name, passed: true };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return failed(c, `response is not JSON: ${text}`);
  }
  const mismatch = subsetMismatch(c.expect.body, body, "body");
  return mismatch ? failed(c, `${mismatch}\n  got: ${text}`) : { name: c.name, passed: true };
}

/**
 * Runs the screen cases, the island cases, then the action cases (spec §8.1). `fetchImpl` as for
 * runComposerCase.
 */
export async function runComposerConformance(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of composerCases()) {
    results.push(await runComposerCase(baseUrl, c, fetchImpl));
  }
  for (const c of islandCases()) {
    results.push(await runIslandCase(baseUrl, { ...c, name: `island: ${c.name}` }, fetchImpl));
  }
  for (const c of actionCases()) {
    results.push(await runActionCase(baseUrl, { ...c, name: `action: ${c.name}` }, fetchImpl));
  }
  return results;
}

/**
 * Objects in `expected` are subsets of `actual`; arrays must match in length and order;
 * everything else must be strictly equal, except `"$absent"`, which requires the value to be
 * missing. Returns a description of the first mismatch.
 */
export function subsetMismatch(
  expected: unknown,
  actual: unknown,
  path: string,
): string | undefined {
  if (expected === "$absent") {
    return actual === undefined
      ? undefined
      : `${path}: expected no value, got ${JSON.stringify(actual)}`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return `${path}: expected array, got ${JSON.stringify(actual)}`;
    }
    if (expected.length !== actual.length) {
      return `${path}: expected ${expected.length} items, got ${actual.length}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const m = subsetMismatch(expected[i], actual[i], `${path}[${i}]`);
      if (m) {
        return m;
      }
    }
    return undefined;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return `${path}: expected object, got ${JSON.stringify(actual)}`;
    }
    for (const [k, v] of Object.entries(expected)) {
      const m = subsetMismatch(v, Reflect.get(actual, k), `${path}.${k}`);
      if (m) {
        return m;
      }
    }
    return undefined;
  }
  return Object.is(expected, actual)
    ? undefined
    : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}
