// The registry: the islands an app can draw, rendered here or declared as rendered elsewhere.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { IslandDescriptor } from "@client-compose/protocol";

import { IslandRegistry, plan } from "../src/index.ts";
import { island } from "../src/testing.ts";

const HeaderV1: IslandDescriptor<{ title: string }> = { type: "header", version: 1 };
const TodosV1: IslandDescriptor<{ todos: { id: string; done: boolean }[] }> = {
  type: "todos",
  version: 1,
  entities: [
    {
      path: ["todos", "[]"],
      entity: "todo",
      id: "id",
      properties: ["id", "done"],
    },
  ],
};
const TodosV2: IslandDescriptor<{ todos: { id: string; done: boolean }[] }> = {
  ...TodosV1,
  version: 2,
};

test("islands rendered elsewhere are declared: the app can draw them, and their entities are known", () => {
  const registry = new IslandRegistry<string>()
    .register(HeaderV1, (props) => props.title)
    .register(TodosV2, () => "todos")
    .declare(TodosV1);

  assert.deepEqual(registry.capabilities(), { header: [1], todos: [1, 2] });
  assert.deepEqual(registry.entities("todos", 1), TodosV1.entities);
  assert.equal(registry.get("todos", 1), undefined, "it can't render them");
});

test("a screen rendered here skips the islands declared as rendered elsewhere", () => {
  const skipped: string[] = [];
  const registry = new IslandRegistry<string>()
    .register(HeaderV1, (props) => props.title)
    .declare(TodosV1);
  const planned = plan(
    registry,
    {
      protocol: 0,
      screen: "todos",
      islands: [
        island("header", HeaderV1, { title: "Todos" }),
        island("list", TodosV1, { todos: [] }),
      ],
    },
    { onSkipped: (entry) => skipped.push(entry.key) },
  );

  assert.deepEqual(
    planned.map((p) => p.render()),
    ["Todos"],
  );
  assert.deepEqual(skipped, ["list"]);
});
