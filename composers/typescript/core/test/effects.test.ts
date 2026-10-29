// Entity changes and island updates (spec §5.3): what an action changed, as narrowly as it can say.
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ActionDescriptor,
  EntityDescriptor,
  IslandDescriptor,
} from "@client-compose/protocol";

import {
  action,
  changed,
  createComposer,
  deleted,
  type Effects,
  island,
  place,
  screen,
} from "../src/index.ts";
import { testComposer } from "../src/testing.ts";

// As codegen generates them, for a list of items and a count of what's left.

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

interface ItemEntity {
  name?: string;
  done?: boolean;
}
const ItemEntity: EntityDescriptor<ItemEntity> = { entity: "item" };

interface ItemCountEntity {
  left?: number;
}
const ItemCountEntity: EntityDescriptor<ItemCountEntity> = { entity: "item-count" };

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

/** The list the islands show, and the actions change. */
class Items {
  list: Item[] = [];

  left(): number {
    return this.list.filter((item) => !item.done).length;
  }
}

/** What resolvers and actions share for loading: their request's `load`. */
interface Loads {
  load: <T>(key: string, fn: (signal: AbortSignal) => Promise<T> | T) => Promise<T>;
}

/** Loads the list through `load`, so an island would see the action's own load if it shared it. */
function loadItems(items: Items, lc: Loads) {
  return lc.load("items", () => items.list.map((item) => ({ ...item })));
}

function composerFor(
  items: Items,
  finish: (id: string) => Effects,
  options: { leftWhen?: () => boolean; itemsFail?: boolean } = {},
) {
  const itemsIsland = island(ItemsV1, async (rc) => {
    if (options.itemsFail) {
      throw new Error("down");
    }

    return { items: await loadItems(items, rc) };
  });
  const leftIsland = island(LeftV1, () => ({ id: "all", left: items.left() }));

  return createComposer({
    screens: [
      screen("list", {
        islands: [
          place("items", itemsIsland),
          place("left", leftIsland, { when: options.leftWhen }),
        ],
      }),
    ],
    actions: [
      action(FinishV1, ({ id }) => {
        const item = items.list.find((candidate) => candidate.id === id);
        if (item) {
          item.done = true;
        }

        return { result: {}, effects: finish(id) };
      }),
      action(AddV1, async ({ name }, ac) => {
        // Loaded before the change, as an action checking the list first would.
        await loadItems(items, ac);
        items.list.push({
          id: String(items.list.length + 1),
          name,
          done: false,
        });

        return {
          result: {},
          effects: {
            update: [
              { screen: "list", key: "items" },
              { screen: "list", key: "left" },
            ],
          },
        };
      }),
    ],
  });
}

const finished = (items: Items) => (id: string) => ({
  changes: [
    changed(ItemEntity, id, { done: true }),
    changed(ItemCountEntity, "all", { left: items.left() }),
  ],
});

test("changes go to clients as the action set them", async () => {
  const items = new Items();
  const app = testComposer(
    composerFor(items, (id) => ({
      changes: [changed(ItemEntity, id, { done: true }), deleted(ItemEntity, "2")],
    })),
  );

  const out = await app.perform(FinishV1, { id: "1" });

  assert.deepEqual(out.effects, {
    changes: [
      {
        entity: "item",
        id: "1",
        set: { done: true },
      },
      {
        entity: "item",
        id: "2",
        delete: true,
      },
    ],
  });
});

test("an update is the island resolved again, in a fresh scope", async () => {
  const app = testComposer(composerFor(new Items(), () => ({})));

  const out = await app.perform(AddV1, { name: "Milk" });

  // The action loaded the list before adding to it; the update has the item it added.
  assert.deepEqual(
    out.effects?.update?.map((u) => [
      u.screen,
      u.params,
      u.island.key,
      u.island.status === "ok" && u.island.props,
    ]),
    [
      [
        "list",
        {},
        "items",
        {
          items: [
            {
              id: "1",
              name: "Milk",
              done: false,
            },
          ],
        },
      ],
      ["list", {}, "left", { id: "all", left: 1 }],
    ],
  );
  assert.equal(out.effects?.invalidate, undefined);
});

test("an update the client can't take invalidates its screen instead", async () => {
  const cases = {
    "not on the screen any more": testComposer(
      composerFor(new Items(), () => ({}), { leftWhen: () => false }),
    ),
    failing: testComposer(composerFor(new Items(), () => ({}), { itemsFail: true })),
    "no version the client knows": testComposer(
      composerFor(new Items(), () => ({})),
      { declare: [LeftV1] },
    ),
  };
  for (const [name, app] of Object.entries(cases)) {
    const out = await app.perform(AddV1, { name: "Milk" });
    assert.deepEqual(out.effects?.invalidate, [{ screen: "list", params: {} }], name);
  }
});

test("checkEffects passes when an action says everything it changed", async () => {
  const items = new Items();
  items.list = [
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
  ];
  const app = testComposer(composerFor(items, finished(items)));

  await app.checkEffects("list", {}, () => app.perform(FinishV1, { id: "1" }));
  await app.checkEffects("list", {}, () => app.perform(AddV1, { name: "Bread" }));
});

test("checkEffects catches what an action forgot", async () => {
  const items = new Items();
  items.list = [
    {
      id: "1",
      name: "Milk",
      done: false,
    },
  ];
  const forgetsTheCount = (id: string) => ({ changes: [changed(ItemEntity, id, { done: true })] });
  const app = testComposer(composerFor(items, forgetsTheCount));

  await assert.rejects(
    app.checkEffects("list", {}, () => app.perform(FinishV1, { id: "1" })),
    /island left shows/,
  );
});
