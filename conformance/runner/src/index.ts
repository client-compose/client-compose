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
  }[];
  capabilities: Record<string, number[]>;
  request?: Record<string, unknown>;
  path?: string;
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

export interface CaseResult {
  name: string;
  passed: boolean;
  message?: string;
}

const SUITES = {
  composer: "composer/cases.json",
  actions: "composer/action-cases.json",
  client: "client/cases.json",
} as const;

/**
 * The published package carries the cases in dist/cases/ (copied at build time); in this repo
 * they're read from conformance/.
 */
function load<T>(suite: keyof typeof SUITES): T {
  const bundled = new URL(`./cases/${suite}.json`, import.meta.url);
  const inRepo = new URL(`../../${SUITES[suite]}`, import.meta.url);
  const file = existsSync(bundled) ? bundled : inRepo;
  return (JSON.parse(readFileSync(file, "utf8")) as { cases: T }).cases;
}

export const composerCases = (): ComposerCase[] => load("composer");
export const actionCases = (): ActionCase[] => load("actions");
export const clientCases = (): ClientCase[] => load("client");

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
  return post(
    fetchImpl,
    `${baseUrl.replace(/\/$/, "")}/screens/${encodeURIComponent(path)}`,
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

async function post(
  fetchImpl: typeof fetch,
  url: string,
  body: string,
  c: { name: string; expect: { status: number; body?: unknown } },
): Promise<CaseResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await res.text();
    if (res.status !== c.expect.status) {
      return {
        name: c.name,
        passed: false,
        message: `expected status ${c.expect.status}, got ${res.status}: ${text}`,
      };
    }
    if (c.expect.body !== undefined) {
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { name: c.name, passed: false, message: `response is not JSON: ${text}` };
      }
      const mismatch = subsetMismatch(c.expect.body, body, "body");
      if (mismatch) return { name: c.name, passed: false, message: `${mismatch}\n  got: ${text}` };
    }
    return { name: c.name, passed: true };
  } catch (err) {
    return { name: c.name, passed: false, message: `request failed: ${String(err)}` };
  }
}

/** Runs the screen cases, then the action cases (spec §8.1). `fetchImpl` as for runComposerCase. */
export async function runComposerConformance(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of composerCases()) results.push(await runComposerCase(baseUrl, c, fetchImpl));
  for (const c of actionCases())
    results.push(await runActionCase(baseUrl, { ...c, name: `action: ${c.name}` }, fetchImpl));
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
  if (expected === "$absent")
    return actual === undefined
      ? undefined
      : `${path}: expected no value, got ${JSON.stringify(actual)}`;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `${path}: expected array, got ${JSON.stringify(actual)}`;
    if (expected.length !== actual.length) {
      return `${path}: expected ${expected.length} items, got ${actual.length}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const m = subsetMismatch(expected[i], actual[i], `${path}[${i}]`);
      if (m) return m;
    }
    return undefined;
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return `${path}: expected object, got ${JSON.stringify(actual)}`;
    }
    for (const [k, v] of Object.entries(expected)) {
      const m = subsetMismatch(v, (actual as Record<string, unknown>)[k], `${path}.${k}`);
      if (m) return m;
    }
    return undefined;
  }
  return Object.is(expected, actual)
    ? undefined
    : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}
