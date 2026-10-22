import assert from "node:assert/strict";
import { test } from "node:test";

import type { ScreenRequest } from "@client-compose/protocol";

import {
  createComposer,
  defineBatchLoader,
  type Island,
  type LayoutContext,
  LoadNotFoundError,
  NotFoundError,
  type Placement,
  type ResolveContext,
  screen,
} from "../src/index.ts";

type Resolve = (rc: ResolveContext<null>) => unknown;

/** A screen whose islands are the given resolvers, keyed a, b, c… in order. */
function compose(
  resolvers: Resolve[],
  layout?: (rc: LayoutContext<null>) => unknown,
  timeoutMs?: number,
) {
  const islands = resolvers.map((resolve, i): Placement<null> => ({
    key: String.fromCharCode(97 + i),
    timeoutMs,
    versions: [{ type: `t${i}`, version: 1, resolve } as Island<null, unknown>],
  }));
  const s = screen<null>("s", {
    layout: async (rc) => {
      await layout?.(rc);
      return islands;
    },
  });
  const request: ScreenRequest = {
    protocol: 0,
    screen: "s",
    client: { platform: "test", appVersion: "1" },
    islands: Object.fromEntries(resolvers.map((_, i) => [`t${i}`, [1]])),
  };
  return createComposer<null>({ screens: [s] }).compose(request, null);
}

const props = async (result: ReturnType<typeof compose>) => {
  const r = await result;
  assert.equal(r.status, 200);
  return (
    r.body as { islands: { status: string; props?: unknown; error?: { code: string } }[] }
  ).islands.map((i) => (i.status === "ok" ? i.props : i.error!.code));
};

test("the layout and resolvers share loads by key", async () => {
  let calls = 0;
  // The README's helper pattern: one function, usable from the layout and resolvers.
  const user = (rc: LayoutContext<null>) =>
    rc.load("user:1", async () => {
      calls++;
      return { name: "Ada" };
    });
  const result = await props(
    compose(
      [
        async (rc) => ({ name: (await user(rc)).name }),
        async (rc) => ({ initial: (await user(rc)).name[0] }),
      ],
      user,
    ),
  );
  assert.deepEqual(result, [{ name: "Ada" }, { initial: "A" }]);
  assert.equal(calls, 1);
});

test("a failing load fails every island that shares it, and runs once", async () => {
  let calls = 0;
  const failing: Resolve = (rc) =>
    rc.load("user:1", () => {
      calls++;
      throw new Error("users service down");
    });
  assert.deepEqual(await props(compose([failing, failing, () => ({ ok: true })])), [
    "resolve_failed",
    "resolve_failed",
    { ok: true },
  ]);
  assert.equal(calls, 1);
});

test("shared work still running when the request is done is cancelled", async () => {
  let shared: AbortSignal | undefined;
  const slow: Resolve = (rc) =>
    rc.load("slow", (signal) => {
      shared = signal;
      return new Promise(() => {});
    });
  assert.deepEqual(await props(compose([slow], undefined, 20)), ["timeout"]);
  assert.equal(shared?.aborted, true);
});

test("batch loaders combine and de-duplicate keys from every island into one call", async () => {
  const batches: string[][] = [];
  const userById = defineBatchLoader(async (ids: string[]) => {
    batches.push(ids);
    return new Map(ids.map((id) => [id, { id, name: `user ${id}` }]));
  });
  const result = await props(
    compose([
      async (rc) => userById.load(rc, "1"),
      async (rc) => userById.load(rc, "2"),
      async (rc) => {
        await rc.load("something-else-first", () => "x");
        return userById.load(rc, "1");
      },
    ]),
  );
  assert.deepEqual(result, [
    { id: "1", name: "user 1" },
    { id: "2", name: "user 2" },
    { id: "1", name: "user 1" },
  ]);
  assert.deepEqual(batches, [["1", "2"]]);
});

test("batch loaders: missing keys reject, array results align, maxBatchSize splits", async () => {
  const batches: number[][] = [];
  const square = defineBatchLoader(
    async (ns: number[]) => {
      batches.push(ns);
      return ns.map((n) => (n < 0 ? undefined : n * n));
    },
    { maxBatchSize: 2 },
  );
  const result = await props(
    compose([
      (rc) => square.load(rc, 2).then((v) => ({ v })),
      (rc) => square.load(rc, -1),
      (rc) => square.load(rc, 3).then((v) => ({ v })),
    ]),
  );
  assert.deepEqual(result, [{ v: 4 }, "resolve_failed", { v: 9 }]);
  assert.deepEqual(batches, [[2, -1], [3]]);
  assert.equal(new LoadNotFoundError(-1).message, "No value loaded for key -1");
});

test("batch loaders never share results between requests", async () => {
  let calls = 0;
  const loader = defineBatchLoader(async (ids: string[]) => {
    calls++;
    return ids;
  });
  await props(compose([(rc) => loader.load(rc, "1").then((v) => ({ v }))]));
  await props(compose([(rc) => loader.load(rc, "1").then((v) => ({ v }))]));
  assert.equal(calls, 2);
});

test("batch loaders need a composer context", () => {
  const loader = defineBatchLoader(async (ids: string[]) => ids);
  assert.throws(() => loader.load({} as never, "1"), /Batch loaders need the context/);
});

test("NotFoundError (or a batch loader's missing key) in a layout is a 404, and a failing meta is dropped", async () => {
  const userById = defineBatchLoader(async (ids: string[]) => ids.map(() => undefined));
  const request: ScreenRequest = {
    protocol: 0,
    screen: "s",
    client: { platform: "test", appVersion: "1" },
    islands: { t: [1] },
  };
  for (const layout of [
    () => {
      throw new NotFoundError();
    },
    async (rc: LayoutContext<null>) => [await userById.load(rc, "x")],
  ]) {
    const result = await createComposer<null>({
      screens: [screen<null>("s", { layout: layout as never })],
    }).compose(request, null);
    assert.equal(result.status, 404);
    assert.equal((result.body as { error: { code: string } }).error.code, "not_found");
  }

  const metaErrors: unknown[] = [];
  const s = screen<null>("s", {
    meta: () => {
      throw new Error("meta broke");
    },
    islands: [{ key: "k", versions: [{ type: "t", version: 1, resolve: () => ({ ok: true }) }] }],
  });
  const result = await createComposer<null>({
    screens: [s],
    use: [{ error: (f) => f.kind === "meta" && metaErrors.push(f.error) }],
  }).compose(request, null);
  assert.equal(result.status, 200);
  assert.equal("meta" in result.body, false);
  assert.equal(metaErrors.length, 1);
});
