import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor, ActionRequest } from "@client-compose/protocol";

import { ActionFetchError, callAction, newIdempotencyKey } from "../src/index.ts";

type Error = { code: "taken"; details: { suggestion: string } };
const Rename: ActionDescriptor<{ name: string }, { id: string }, Error> = {
  action: "rename",
  version: 2,
  errors: ["taken"],
  input: { type: "object" },
};
const client = { platform: "web", appVersion: "1.0.0" };

function fakeFetch(
  status: number,
  body: unknown,
  seen: { url?: string; request?: ActionRequest } = {},
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.request = JSON.parse(init.body as string);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

test("callAction posts a typed request with a fresh idempotency key", async () => {
  const seen: { url?: string; request?: ActionRequest } = {};
  const ok = {
    protocol: 0,
    action: "rename",
    version: 2,
    status: "ok",
    result: { id: "t1" },
  };
  const res = await callAction(
    "https://api.test",
    Rename,
    { name: "New" },
    { client, fetch: fakeFetch(200, ok, seen) },
  );
  assert.equal(seen.url, "https://api.test/actions/rename");
  assert.deepEqual(
    { ...seen.request, idempotencyKey: typeof seen.request?.idempotencyKey },
    {
      protocol: 0,
      action: "rename",
      version: 2,
      input: { name: "New" },
      client,
      idempotencyKey: "string",
    },
  );
  assert.equal(res.status === "ok" && res.result.id, "t1");
});

test("callAction reuses a given idempotency key, for retries", async () => {
  const seen: { request?: ActionRequest } = {};
  const ok = {
    protocol: 0,
    action: "rename",
    version: 2,
    status: "ok",
    result: { id: "t1" },
  };
  await callAction(
    "",
    Rename,
    { name: "x" },
    {
      client,
      idempotencyKey: "k1",
      fetch: fakeFetch(200, ok, seen),
    },
  );
  assert.equal(seen.request?.idempotencyKey, "k1");
});

test("declared errors are outcomes, not exceptions", async () => {
  const body = {
    protocol: 0,
    action: "rename",
    version: 2,
    status: "error",
    error: { code: "taken", details: { suggestion: "x2" } },
  };
  const res = await callAction("", Rename, { name: "x" }, { client, fetch: fakeFetch(200, body) });
  assert.equal(
    res.status === "error" && res.error.code === "taken" && res.error.details.suggestion,
    "x2",
  );
});

test("protocol errors throw ActionFetchError with their code", async () => {
  const body = { protocol: 0, error: { code: "unauthenticated" } };
  await assert.rejects(
    callAction("", Rename, { name: "x" }, { client, fetch: fakeFetch(401, body) }),
    (err: unknown) => {
      assert.ok(err instanceof ActionFetchError);
      assert.deepEqual([err.status, err.code], [401, "unauthenticated"]);
      return true;
    },
  );
  await assert.rejects(
    callAction("", Rename, { name: "x" }, { client, fetch: fakeFetch(502, "Bad Gateway") }),
    (err: unknown) => {
      assert.ok(err instanceof ActionFetchError && err.code === undefined);
      return true;
    },
  );
});

test("idempotency keys are unique, with or without crypto.randomUUID", () => {
  const keys = new Set(Array.from({ length: 100 }, newIdempotencyKey));
  const original = globalThis.crypto.randomUUID;
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    for (let i = 0; i < 100; i++) {
      keys.add(newIdempotencyKey());
    }
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
  }
  assert.equal(keys.size, 200);
  for (const k of keys) {
    assert.match(k, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
