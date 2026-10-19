import { readFileSync } from "node:fs";

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

const load = <T>(path: string): T =>
  (JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { cases: T }).cases;

export const composerCases = (): ComposerCase[] => load("../../composer/cases.json");
export const clientCases = (): ClientCase[] => load("../../client/cases.json");

export async function runComposerCase(baseUrl: string, c: ComposerCase): Promise<CaseResult> {
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
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/screens/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: c.rawBody ?? JSON.stringify(request),
    });
    const text = await res.text();
    if (res.status !== c.expect.status) {
      return { name: c.name, passed: false, message: `expected status ${c.expect.status}, got ${res.status}: ${text}` };
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

export async function runComposerConformance(baseUrl: string): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of composerCases()) results.push(await runComposerCase(baseUrl, c));
  return results;
}

/**
 * Objects in `expected` are subsets of `actual`; arrays must match in length and order;
 * everything else must be strictly equal. Returns a description of the first mismatch.
 */
export function subsetMismatch(expected: unknown, actual: unknown, path: string): string | undefined {
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
  return Object.is(expected, actual) ? undefined : `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}
