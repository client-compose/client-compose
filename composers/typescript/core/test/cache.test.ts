// Data that opts in to the cache (CMP-18): kept between requests by kind, cleared by what actions
// say changed, and fetched once while missing.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor, IslandDescriptor } from "@client-compose/protocol";

import {
  action,
  type Cache,
  changed,
  createComposer,
  defineData,
  entityTag,
  type Failure,
  island,
  place,
  reportErrors,
  screen,
} from "../src/index.ts";
import { memoryCache, testComposer } from "../src/testing.ts";

interface Item {
  id: string;
  name: string;
  done: boolean;
}

const ItemsV1: IslandDescriptor<{ items: Item[] }> = {
  type: "items",
  version: 1,
  entities: [
    {
      path: ["items", "[]"],
      entity: "item",
      id: "id",
      properties: ["id", "name", "done"],
    },
  ],
};

const LeftV1: IslandDescriptor<{ id: string; left: number }> = { type: "left", version: 1 };

const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };

const FinishV1: ActionDescriptor<{ id: string }, Record<string, never>, never> = {
  action: "finish",
  version: 1,
  errors: [],
  input: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
  },
};

const AddV1: ActionDescriptor<{ name: string }, Record<string, never>, never> = {
  action: "add",
  version: 1,
  errors: [],
  input: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
};

/**
 * The list as data: all of it under one key, tagged with each item it holds and as the list, so
 * adding to it clears it. Its islands read it; actions finish an item (an entity change) and add one
 * (naming the list as stale), reading the list fresh. `forget` leaves `stale` out.
 */
function cachedList(
  list: Item[],
  cache: Cache | undefined,
  options: { forget?: boolean; failures?: Failure[] } = {},
) {
  let fetches = 0;
  const items = defineData(
    "items",
    async (keys: string[]) => {
      fetches++;
      return new Map(keys.map((k) => [k, list.map((item) => ({ ...item }))]));
    },
    {
      cacheMs: 60_000,
      tags: (_key, all) => ["tag:list", ...all.map((item) => entityTag("item", item.id))],
    },
  );
  const itemsIsland = island(ItemsV1, async (rc) => ({ items: await items.load(rc, "all") }));
  const leftIsland = island(LeftV1, async (rc) => ({
    id: "all",
    left: (await items.load(rc, "all")).filter((item) => !item.done).length,
  }));
  const composer = createComposer({
    screens: [
      screen("list", { islands: [place("items", itemsIsland), place("left", leftIsland)] }),
    ],
    actions: [
      action(FinishV1, ({ id }) => {
        const item = list.find((candidate) => candidate.id === id);
        if (item) {
          item.done = true;
        }
        return {
          result: {},
          effects: { changes: [changed({ entity: "item" }, id, { done: true })] },
        };
      }),
      action(AddV1, async ({ name }, call) => {
        // Actions read fresh: a name already on the list (as it is now) isn't added twice.
        const now = await items.load(call, "all");
        if (now.some((item) => item.name === name)) {
          return { result: {} };
        }
        list.push({
          id: String(list.length + 1),
          name,
          done: false,
        });
        return {
          result: {},
          effects: {
            ...(options.forget ? {} : { stale: ["tag:list"] }),
            update: [{ screen: "list", key: "items" }],
          },
        };
      }),
    ],
    cache,
    use: options.failures ? [reportErrors((f) => options.failures?.push(f))] : [],
  });
  return { app: testComposer(composer), fetches: () => fetches };
}

const namesOf = async (app: ReturnType<typeof cachedList>["app"]) =>
  (await app.screen("list"))
    .props(ItemsV1, "items")
    .items.map((item) => (item.done ? `${item.name} (done)` : item.name));

test("data is kept between requests, shared by the islands that show it", async () => {
  const cache = memoryCache();
  const { app, fetches } = cachedList(
    [
      {
        id: "1",
        name: "Milk",
        done: false,
      },
    ],
    cache,
  );
  await app.screen("list");
  await app.screen("list");
  assert.equal(fetches(), 1);
  assert.deepEqual(cache.keys(), ["data:items:all"]);
  assert.deepEqual(cache.tags("data:items:all"), [
    "tag:data:items:all",
    "tag:entity:item:1",
    "tag:list",
  ]);
});

test("without a cache, data is fetched on every request", async () => {
  const { app, fetches } = cachedList([], undefined);
  await app.screen("list");
  await app.screen("list");
  assert.equal(fetches(), 2);
});

test("a change to an entity clears the data holding it", async () => {
  const { app } = cachedList(
    [
      {
        id: "1",
        name: "Milk",
        done: false,
      },
    ],
    memoryCache(),
  );
  await app.screen("list");
  await app.perform(FinishV1, { id: "1" });
  assert.deepEqual(await namesOf(app), ["Milk (done)"]);
  assert.equal((await app.screen("list")).props(LeftV1, "left").left, 0);
});

test("stale clears what it names, and updates are resolved fresh", async () => {
  const { app } = cachedList([], memoryCache());
  await app.screen("list");
  const out = await app.perform(AddV1, { name: "Milk" });
  assert.equal(out.effects?.update?.length, 1);
  assert.deepEqual(await namesOf(app), ["Milk"]);
});

test("actions read fresh data", async () => {
  const list: Item[] = [];
  const { app } = cachedList(list, memoryCache());
  await app.screen("list"); // kept: an empty list
  list.push({
    id: "1",
    name: "Milk",
    done: false,
  }); // behind the cache's back
  await app.perform(AddV1, { name: "Milk" });
  assert.equal(list.length, 1);
});

test("checkEffects catches data an action didn't say changed", async () => {
  const { app } = cachedList([], memoryCache(), { forget: true });
  await assert.rejects(
    app.checkEffects("list", {}, () => app.perform(AddV1, { name: "Milk" })),
    /served from the cache/,
  );
});

test("failures and missing keys are never cached", async () => {
  let fail = true;
  let fetches = 0;
  const users = defineData(
    "user",
    async (ids: string[]) => {
      fetches++;
      if (fail) {
        throw new Error("users service down");
      }
      return new Map(ids.filter((id) => id !== "nobody").map((id) => [id, { name: id }]));
    },
    { cacheMs: 60_000 },
  );
  const cache = memoryCache();
  const header = island(HeaderV1, (rc) => users.load(rc, rc.params.userId ?? ""));
  const app = testComposer(
    createComposer({ screens: [screen("profile", { islands: [place("header", header)] })], cache }),
  );
  assert.equal((await app.screen("profile", { userId: "ada" })).island("header")?.status, "error");
  fail = false;
  assert.equal(
    (await app.screen("profile", { userId: "ada" })).props(HeaderV1, "header").name,
    "ada",
  );
  await app.screen("profile", { userId: "nobody" });
  await app.screen("profile", { userId: "nobody" });
  assert.deepEqual(cache.keys(), ["data:user:ada"]);
  assert.equal(fetches, 4);
});

test("data kept per viewer is never shared, nor cached without a viewer", async () => {
  const compose = (cache: Cache, viewer?: (ctx: { viewer: string }) => string) => {
    let fetches = 0;
    const saved = defineData(
      "saved",
      async (ids: string[], _signal) => {
        fetches++;
        return new Map(ids.map((id) => [id, { name: id }]));
      },
      { cacheMs: 60_000, perViewer: true },
    );
    const header = island<{ name: string }, { viewer: string }>(HeaderV1, async (rc) => ({
      name: `${rc.ctx.viewer}:${(await saved.load(rc, "pasta")).name}`,
    }));
    const app = testComposer(
      createComposer<{ viewer: string }>({
        screens: [screen("profile", { islands: [place("header", header)] })],
        cache,
        context: (request) => ({ viewer: request.headers.get("x-viewer") ?? "" }),
        viewer,
      }),
    );
    return { app, fetches: () => fetches };
  };
  const as = (who: string) => ({ headers: { "x-viewer": who } });

  const cache = memoryCache();
  const { app, fetches } = compose(cache, (ctx) => ctx.viewer);
  await app.screen("profile", {}, as("ada"));
  await app.screen("profile", {}, as("grace"));
  await app.screen("profile", {}, as("ada"));
  assert.equal(fetches(), 2);
  assert.deepEqual(cache.keys().sort(), [
    "data:saved:viewer:ada:pasta",
    "data:saved:viewer:grace:pasta",
  ]);

  const unknown = memoryCache();
  const fresh = compose(unknown);
  await fresh.app.screen("profile", {}, as("ada"));
  await fresh.app.screen("profile", {}, as("ada"));
  assert.equal(fresh.fetches(), 2);
  assert.deepEqual(unknown.keys(), []);
});

test("requests missing the same entry share one fetch", async () => {
  let fetches = 0;
  const users = defineData(
    "user",
    async (ids: string[]) => {
      fetches++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Map(ids.map((id) => [id, { name: "Ada" }]));
    },
    { cacheMs: 60_000 },
  );
  const header = island(HeaderV1, (rc) => users.load(rc, "ada"));
  const app = testComposer(
    createComposer({
      screens: [screen("profile", { islands: [place("header", header)] })],
      cache: memoryCache(),
    }),
  );
  const names = await Promise.all(
    Array.from(
      { length: 8 },
      async () => (await app.screen("profile")).props(HeaderV1, "header").name,
    ),
  );
  assert.deepEqual(new Set(names), new Set(["Ada"]));
  assert.equal(fetches, 1);
});

test("a broken cache is reported and bypassed", async () => {
  const broken: Cache = {
    getMany: () => Promise.reject(new Error("redis down")),
    set: () => Promise.reject(new Error("redis down")),
    invalidate: () => Promise.reject(new Error("redis down")),
  };
  const failures: Failure[] = [];
  const { app } = cachedList(
    [
      {
        id: "1",
        name: "Milk",
        done: false,
      },
    ],
    broken,
    { failures },
  );
  assert.deepEqual(await namesOf(app), ["Milk"]);
  const out = await app.perform(FinishV1, { id: "1" });
  assert.equal(out.status, "ok");
  assert.ok(failures.some((f) => f.kind === "cache" && !("action" in f && f.action)));
  assert.ok(failures.some((f) => f.kind === "cache" && "action" in f && f.action === "finish"));
});
