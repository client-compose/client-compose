import assert from "node:assert/strict";
import { test } from "node:test";

import { ConformanceV1 } from "../src/conformance-actions.generated.ts";
import {
  action,
  createComposer,
  type Failure,
  type IdempotencyStore,
  reportErrors,
} from "../src/index.ts";
import { memoryIdempotencyStore, testComposer } from "../src/testing.ts";

// ---- Idempotency ----

/** An action that counts its runs; "fail" fails, "rejected" returns a declared error. */
function echo(gate?: Promise<void>) {
  let runs = 0;
  const handler = action(ConformanceV1, async (input) => {
    const n = ++runs;
    if (input.outcome === "fail") {
      throw new Error("boom");
    }
    if (input.outcome === "rejected") {
      return { error: { code: "rejected", details: { echo: input.echo } } };
    }
    await gate;
    return {
      result: { echo: `${input.echo}${n}`, version: 1 },
      effects: { invalidate: [{ screen: "feed" }] },
    };
  });
  return { handler, runs: () => runs };
}

interface Viewer {
  viewer: string;
}
const byViewer = (store = memoryIdempotencyStore()) => ({
  store,
  scope: (ctx: Viewer) => ctx.viewer,
});
const as = (viewer: string) => ({ headers: { authorization: viewer } });
const viewerContext = (request: Request): Viewer => ({
  viewer: request.headers.get("authorization") ?? "",
});
const hi = { outcome: "ok" as const, echo: "hi" };

test("retried actions return their first outcome", async () => {
  const { handler, runs } = echo();
  const app = testComposer(
    createComposer({
      actions: [handler],
      context: viewerContext,
      idempotency: byViewer(),
    }),
  );
  const first = await app.perform(ConformanceV1, hi, { ...as("ada"), idempotencyKey: "k1" });
  const retry = await app.perform(ConformanceV1, hi, { ...as("ada"), idempotencyKey: "k1" });
  assert.deepEqual(
    [first.result?.echo, retry.result?.echo, retry.effects],
    ["hi1", "hi1", { invalidate: [{ screen: "feed" }] }],
  );
  assert.equal(runs(), 1);
  // Another viewer's call with the same key is theirs; a new key is a new intent; no key, no memory.
  assert.equal(
    (await app.perform(ConformanceV1, hi, { ...as("grace"), idempotencyKey: "k1" })).result?.echo,
    "hi2",
  );
  assert.equal(
    (await app.perform(ConformanceV1, hi, { ...as("ada"), idempotencyKey: "k2" })).result?.echo,
    "hi3",
  );
  await app.perform(ConformanceV1, hi, as("ada"));
  await app.perform(ConformanceV1, hi, as("ada"));
  assert.equal(runs(), 5);
});

test("declared errors are kept, and failures release the key", async () => {
  const { handler, runs } = echo();
  const app = testComposer(
    createComposer({
      actions: [handler],
      context: viewerContext,
      idempotency: byViewer(),
    }),
  );
  for (let i = 0; i < 2; i++) {
    const out = await app.perform(
      ConformanceV1,
      { outcome: "rejected", echo: "taken" },
      { idempotencyKey: "k1" },
    );
    assert.equal(out.error?.code, "rejected");
  }
  for (let i = 0; i < 2; i++) {
    const out = await app.perform(
      ConformanceV1,
      { outcome: "fail", echo: "x" },
      { idempotencyKey: "k2" },
    );
    assert.equal(out.failure, "action_failed");
  }
  assert.equal(runs(), 3); // the declared error once, the failure twice
});

test("a duplicate in flight waits for the first", async () => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const { handler, runs } = echo(gate);
  const app = testComposer(
    createComposer({
      actions: [handler],
      context: viewerContext,
      idempotency: byViewer(),
    }),
  );
  const calls = [1, 2].map(() => app.perform(ConformanceV1, hi, { idempotencyKey: "k1" }));
  setTimeout(open, 100);
  const results = await Promise.all(calls);
  assert.deepEqual(
    results.map((r) => r.result?.echo),
    ["hi1", "hi1"],
  );
  assert.equal(runs(), 1);
});

test("a broken idempotency store is reported, and the action runs", async () => {
  const broken: IdempotencyStore = {
    begin: () => Promise.reject(new Error("redis down")),
    finish: () => {},
    release: () => {},
  };
  const failures: Failure[] = [];
  const { handler } = echo();
  const app = testComposer(
    createComposer({
      actions: [handler],
      context: viewerContext,
      idempotency: byViewer(broken),
      use: [reportErrors((f) => failures.push(f))],
    }),
  );
  assert.equal((await app.perform(ConformanceV1, hi, { idempotencyKey: "k1" })).status, "ok");
  assert.deepEqual(
    failures.map((f) => [f.kind, f.action]),
    [["idempotency", "conformance"]],
  );
});
