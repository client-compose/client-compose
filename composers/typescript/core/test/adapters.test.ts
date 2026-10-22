import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type Cache,
  createComposer,
  type Failure,
  island,
  type IslandDescriptor,
  place,
  reportErrors,
  screen,
} from "../src/index.ts";
import { memoryCache, testComposer } from "../src/testing.ts";

const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };

/** A header island that counts how often it really resolves, cached by the userId param. */
function counted(
  options: {
    key?: (params: Record<string, string>) => string | undefined;
    fail?: () => boolean;
  } = {},
) {
  let runs = 0;
  const header = island(
    HeaderV1,
    ({ params }) => {
      if (options.fail?.()) throw new Error("users service down");
      return { name: `${params.userId}${++runs}` };
    },
    { cache: { ttlMs: 60_000, key: ({ params }) => (options.key ?? ((p) => p.userId))(params) } },
  );
  return { header, runs: () => runs };
}

const profileWith = (header: ReturnType<typeof counted>["header"]) =>
  screen("profile", { islands: [place("header", header)] });

test("cached islands are served from the cache, by their key", async () => {
  const { header, runs } = counted();
  const cache = memoryCache();
  const app = testComposer(createComposer({ screens: [profileWith(header)], cache }));
  const name = async (userId: string) =>
    (await app.screen("profile", { userId })).props(HeaderV1, "header").name;

  assert.deepEqual(
    [await name("ada"), await name("ada"), await name("grace")],
    ["ada1", "ada1", "grace2"],
  );
  assert.equal(runs(), 2);
  assert.deepEqual(cache.keys().sort(), ["island:header:1:ada", "island:header:1:grace"]);
});

test("without a cache, islands always resolve", async () => {
  const { header, runs } = counted();
  const app = testComposer(createComposer({ screens: [profileWith(header)] }));
  await app.screen("profile", { userId: "ada" });
  await app.screen("profile", { userId: "ada" });
  assert.equal(runs(), 2);
});

test("an empty key skips the cache", async () => {
  const { header, runs } = counted({ key: () => undefined });
  const cache = memoryCache();
  const app = testComposer(createComposer({ screens: [profileWith(header)], cache }));
  await app.screen("profile", { userId: "ada" });
  await app.screen("profile", { userId: "ada" });
  assert.equal(runs(), 2);
  assert.deepEqual(cache.keys(), []);
});

test("failures are never cached", async () => {
  let fail = true;
  const { header } = counted({ fail: () => fail });
  const app = testComposer(
    createComposer({ screens: [profileWith(header)], cache: memoryCache() }),
  );
  assert.equal((await app.screen("profile", { userId: "ada" })).island("header")?.status, "error");
  fail = false;
  assert.equal(
    (await app.screen("profile", { userId: "ada" })).props(HeaderV1, "header").name,
    "ada1",
  );
});

test("a broken cache is reported and bypassed", async () => {
  const broken: Cache = {
    get: () => Promise.reject(new Error("redis down")),
    set: () => Promise.reject(new Error("redis down")),
  };
  const failures: Failure[] = [];
  const { header } = counted();
  const app = testComposer(
    createComposer({
      screens: [profileWith(header)],
      cache: broken,
      use: [reportErrors((f) => failures.push(f))],
    }),
  );
  assert.equal(
    (await app.screen("profile", { userId: "ada" })).props(HeaderV1, "header").name,
    "ada1",
  );
  assert.deepEqual(
    failures.map((f) => [f.kind, f.screen, f.key]),
    [
      ["cache", "profile", "header"],
      ["cache", "profile", "header"],
    ],
  );
});
