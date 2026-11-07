// The island cache (CMP-18): entries filed under the islands and entities they hold, invalidated by
// what actions say they changed, each audience apart, and resolved once while missing.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor, IslandDescriptor } from "@client-compose/protocol";

import {
  action,
  type Cache,
  changed,
  createComposer,
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

const LeftV1: IslandDescriptor<{ id: string; left: number }> = {
  type: "left",
  version: 1,
  entities: [
    {
      path: [],
      entity: "item-count",
      id: "id",
      properties: ["id", "left"],
    },
  ],
};

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

interface Ctx {
  audience: string;
}

const asMember = { headers: { "x-audience": "member" } };

/**
 * A list of items and what's left, both cached (the items each audience apart), with actions to
 * finish an item (an entity change), add one (an update), and add "everything" (invalidating the
 * screen).
 */
function cachedList(list: Item[], cache: Cache, failures: Failure[] = []) {
  let runs = 0;
  const left = () => list.filter((item) => !item.done).length;
  const items = island<{ items: Item[] }, Ctx>(
    ItemsV1,
    () => {
      runs++;
      return { items: list.map((item) => ({ ...item })) };
    },
    {
      cache: {
        ttlMs: 60_000,
        key: () => "all",
        varyBy: ({ ctx }) => ctx.audience,
      },
    },
  );
  const leftIsland = island(LeftV1, () => ({ id: "all", left: left() }), {
    cache: { ttlMs: 60_000, key: () => "all" },
  });
  const composer = createComposer<Ctx>({
    screens: [screen("list", { islands: [place("items", items), place("left", leftIsland)] })],
    actions: [
      action(FinishV1, ({ id }) => {
        const item = list.find((candidate) => candidate.id === id);
        if (item) {
          item.done = true;
        }
        return {
          result: {},
          effects: {
            changes: [
              changed({ entity: "item" }, id, { done: true }),
              changed({ entity: "item-count" }, "all", { left: left() }),
            ],
          },
        };
      }),
      action(AddV1, ({ name }) => {
        list.push({
          id: String(list.length + 1),
          name,
          done: false,
        });
        return {
          result: {},
          effects:
            name === "everything"
              ? { invalidate: [{ screen: "list" }] }
              : { update: [{ screen: "list", key: "items" }] },
        };
      }),
    ],
    cache,
    context: (request: Request) => ({ audience: request.headers.get("x-audience") ?? "visitor" }),
    use: [reportErrors((failure) => failures.push(failure))],
  });
  return { app: testComposer(composer), runs: () => runs };
}

const names = async (
  app: ReturnType<typeof cachedList>["app"],
  options: { headers?: Record<string, string> } = {},
) =>
  (await app.screen("list", {}, options))
    .props(ItemsV1, "items")
    .items.map((item) => (item.done ? `${item.name} (done)` : item.name));

test("cached islands are filed under themselves and the entities they hold", async () => {
  const cache = memoryCache();
  const { app } = cachedList(
    [
      {
        id: "1",
        name: "Milk",
        done: false,
      },
      {
        id: "2",
        name: "Eggs",
        done: false,
      },
    ],
    cache,
  );
  await app.screen("list");

  assert.deepEqual(cache.tags("island:items:1:all@visitor"), [
    "tag:entity:item:1",
    "tag:entity:item:2",
    "tag:island:items:1:all",
  ]);
});

test("a change to an entity invalidates the islands holding it", async () => {
  const { app, runs } = cachedList(
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
  await app.screen("list");
  assert.equal(runs(), 1);

  await app.perform(FinishV1, { id: "1" });

  assert.deepEqual(await names(app), ["Milk (done)"]);
  assert.equal((await app.screen("list")).props(LeftV1, "left").left, 0);
});

test("an update invalidates the island for every audience, and is resolved fresh", async () => {
  const { app } = cachedList([], memoryCache());
  await app.screen("list");
  await app.screen("list", {}, asMember);

  const outcome = await app.perform(AddV1, { name: "Milk" });

  assert.equal(outcome.effects?.update?.length, 1);
  assert.deepEqual(await names(app), ["Milk"]);
  assert.deepEqual(await names(app, asMember), ["Milk"]);
});

test("invalidating a screen invalidates its cached islands", async () => {
  const { app } = cachedList([], memoryCache());
  await app.screen("list");

  await app.perform(AddV1, { name: "everything" });

  assert.deepEqual(await names(app), ["everything"]);
  assert.equal((await app.screen("list")).props(LeftV1, "left").left, 1);
});

test("each audience has its own entry", async () => {
  const cache = memoryCache();
  const { app, runs } = cachedList([], cache);
  await app.screen("list");
  await app.screen("list", {}, asMember);

  assert.deepEqual(cache.keys().sort(), [
    "island:items:1:all@member",
    "island:items:1:all@visitor",
    "island:left:1:all",
  ]);
  assert.equal(runs(), 2);
});

test("requests for an entry being resolved wait for it", async () => {
  const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };
  let runs = 0;
  const slow = island(
    HeaderV1,
    async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { name: "Ada" };
    },
    { cache: { ttlMs: 60_000, key: () => "all" } },
  );
  const app = testComposer(
    createComposer({
      screens: [screen("profile", { islands: [place("header", slow)] })],
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
  assert.equal(runs, 1);
});

test("a cache that can't invalidate is reported, and the action still succeeds", async () => {
  const failures: Failure[] = [];
  const broken: Cache = {
    get: () => undefined,
    set: () => {},
    invalidate: () => Promise.reject(new Error("redis down")),
  };
  const { app } = cachedList(
    [
      {
        id: "1",
        name: "Milk",
        done: false,
      },
    ],
    broken,
    failures,
  );

  const outcome = await app.perform(FinishV1, { id: "1" });

  assert.equal(outcome.status, "ok");
  assert.ok(failures.some((f) => f.kind === "cache" && f.action === "finish"));
});
