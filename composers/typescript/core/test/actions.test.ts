import { test } from "node:test";
import assert from "node:assert/strict";
import { createActions, defineAction, ForbiddenError, performHttp } from "../src/index.ts";
import { ConformanceV1, type ConformanceV1Input } from "../src/conformance-actions.generated.ts";

const request = (input: unknown) => ({
  protocol: 0 as const,
  action: "conformance",
  version: 1,
  input,
  client: { platform: "web", appVersion: "1" },
});

test("handlers see validated input with null optionals removed", async () => {
  let seen: ConformanceV1Input | undefined;
  const perform = createActions([
    defineAction(ConformanceV1, (input) => {
      seen = input;
      return { result: { echo: input.echo, version: 1 } };
    }),
  ]);
  const res = await perform(request({ outcome: "ok", echo: "hi", count: null, extra: 1 }), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(seen, { outcome: "ok", echo: "hi", extra: 1 });
});

test("failures and undeclared codes are reported and answered with action_failed", async () => {
  const reported: string[] = [];
  const perform = createActions(
    [
      defineAction(ConformanceV1, (input) => {
        if (input.outcome === "fail") throw new Error("boom");
        return { error: { code: "nope" } as never };
      }),
    ],
    { onActionError: (action, version, err) => reported.push(`${action} v${version}: ${(err as Error).message}`) },
  );
  for (const outcome of ["fail", "ok"]) {
    const res = await perform(request({ outcome, echo: "x" }), undefined);
    assert.deepEqual([res.status, res.body], [500, { protocol: 0, error: { code: "action_failed", message: undefined } }]);
  }
  assert.deepEqual(reported, ["conformance v1: boom", "conformance v1: returned undeclared error code nope"]);
});

test("protocol errors are not reported as failures", async () => {
  const reported: unknown[] = [];
  const perform = createActions(
    [
      defineAction(ConformanceV1, () => {
        throw new ForbiddenError();
      }),
    ],
    { onActionError: (...args) => reported.push(args) },
  );
  assert.equal((await perform(request({ outcome: "ok", echo: "x" }), undefined)).status, 403);
  assert.deepEqual(reported, []);
});

test("actions share request-scoped loads, and the adapter's context reaches them", async () => {
  let runs = 0;
  const perform = createActions<{ user: string }>([
    defineAction(ConformanceV1, async (input, { load, ctx }) => {
      const values = await Promise.all([1, 2, 3].map(() => load("k", () => ++runs)));
      return { result: { echo: `${ctx.user}:${values.join(",")}`, version: 1 } };
    }),
  ]);
  const res = await performHttp(perform, "conformance", JSON.stringify(request({ outcome: "ok", echo: "" })), { user: "ada" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.status === 200 && res.body.status === "ok" && res.body.result, { echo: "ada:1,1,1", version: 1 });
});

test("defining an action version twice throws", () => {
  const a = defineAction(ConformanceV1, () => ({ result: { echo: "", version: 1 } }));
  assert.throws(() => createActions([a, a]), /conformance v1 is defined twice/);
});
