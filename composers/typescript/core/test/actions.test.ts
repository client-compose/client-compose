import assert from "node:assert/strict";
import { test } from "node:test";

import { ConformanceV1, type ConformanceV1Input } from "../src/conformance-actions.generated.ts";
import { type Action, action, createComposer, ForbiddenError, reportErrors } from "../src/index.ts";

/** Performs actions in-process, reporting failures as `action vN: message`. */
function performer<Ctx>(actions: Action<Ctx>[], reported?: string[]) {
  const composer = createComposer<Ctx>({
    actions,
    use: [
      reportErrors((f) =>
        reported?.push(`${f.action} v${f.version}: ${(f.error as Error).message}`),
      ),
    ],
  });
  return composer.perform;
}

const request = (input: unknown) => ({
  protocol: 0 as const,
  action: "conformance",
  version: 1,
  input,
  client: { platform: "web", appVersion: "1" },
});

test("handlers see validated input with null optionals removed", async () => {
  let seen: ConformanceV1Input | undefined;
  const perform = performer([
    action(ConformanceV1, (input) => {
      seen = input;
      return { result: { echo: input.echo, version: 1 } };
    }),
  ]);
  const res = await perform(
    request({ outcome: "ok", echo: "hi", count: null, extra: 1 }),
    undefined,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(seen, { outcome: "ok", echo: "hi", extra: 1 });
});

test("failures and undeclared codes are reported and answered with action_failed", async () => {
  const reported: string[] = [];
  const perform = performer(
    [
      action(ConformanceV1, (input) => {
        if (input.outcome === "fail") throw new Error("boom");
        return { error: { code: "nope" } as never };
      }),
    ],
    reported,
  );
  for (const outcome of ["fail", "ok"]) {
    const res = await perform(request({ outcome, echo: "x" }), undefined);
    assert.deepEqual(
      [res.status, res.body],
      [500, { protocol: 0, error: { code: "action_failed", message: undefined } }],
    );
  }
  assert.deepEqual(reported, [
    "conformance v1: boom",
    "conformance v1: returned undeclared error code nope",
  ]);
});

test("protocol errors are not reported as failures", async () => {
  const reported: string[] = [];
  const perform = performer(
    [
      action(ConformanceV1, () => {
        throw new ForbiddenError();
      }),
    ],
    reported,
  );
  assert.equal((await perform(request({ outcome: "ok", echo: "x" }), undefined)).status, 403);
  assert.deepEqual(reported, []);
});

test("actions share request-scoped loads, and the context function's context reaches them", async () => {
  let runs = 0;
  const composer = createComposer<{ user: string }>({
    actions: [
      action(ConformanceV1, async (_, { load, ctx }) => {
        const values = await Promise.all([1, 2, 3].map(() => load("k", () => ++runs)));
        return { result: { echo: `${ctx.user}:${values.join(",")}`, version: 1 } };
      }),
    ],
    context: (req) => ({ user: req.headers.get("x-user") ?? "" }),
  });
  const res = await composer.fetch(
    new Request("https://api.test/compose/actions/conformance", {
      method: "POST",
      headers: { "x-user": "ada" },
      body: JSON.stringify(request({ outcome: "ok", echo: "" })),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).result, { echo: "ada:1,1,1", version: 1 });
});

test("defining an action version twice throws", () => {
  const a = action(ConformanceV1, () => ({ result: { echo: "", version: 1 } }));
  assert.throws(() => createComposer({ actions: [a, a] }), /conformance v1 is defined twice/);
});
