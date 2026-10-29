// Entity changes applied to an island's props (spec §5.3), as every client applies them.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyChanges, type EntityPath, heldEntities } from "@client-compose/protocol";

const todos: EntityPath = {
  path: ["todos", "[]"],
  entity: "todo",
  id: "id",
  properties: ["id", "title", "done"],
};

const props = () => ({
  heading: "Todos",
  todos: [
    {
      id: "1",
      title: "Milk",
      done: false,
    },
    {
      id: "2",
      title: "Eggs",
      done: false,
    },
  ],
});

test("set changes the properties the island shows, of that one entity", () => {
  const before = props();
  const { props: after, reload } = applyChanges(
    before,
    [todos],
    [
      {
        entity: "todo",
        id: "2",
        set: { done: true, dueAt: "tomorrow" },
      },
    ],
  );

  assert.equal(reload, false);
  assert.deepEqual(after.todos, [
    {
      id: "1",
      title: "Milk",
      done: false,
    },
    {
      id: "2",
      title: "Eggs",
      done: true,
    },
  ]);
  // Unchanged parts are the same objects, so a renderer can skip them.
  assert.equal(after.todos[0], before.todos[0]);
  assert.equal(before.todos[1]?.done, false, "the props it was given are left alone");
});

test("a change to another entity, or another id, changes nothing", () => {
  const before = props();
  const { props: after } = applyChanges(
    before,
    [todos],
    [
      {
        entity: "recipe",
        id: "1",
        set: { title: "Soup" },
      },
      {
        entity: "todo",
        id: "9",
        set: { done: true },
      },
    ],
  );

  assert.equal(after, before);
});

test("delete removes an entity from the list holding it, and anywhere else asks for a reload", () => {
  const { props: after, reload } = applyChanges(
    props(),
    [todos],
    [
      {
        entity: "todo",
        id: "1",
        delete: true,
      },
    ],
  );
  assert.equal(reload, false);
  assert.deepEqual(
    after.todos.map((t) => t.id),
    ["2"],
  );

  const single: EntityPath = {
    path: ["todo"],
    entity: "todo",
    id: "id",
    properties: ["id"],
  };
  const detail = { todo: { id: "1" } };
  assert.equal(
    applyChanges(
      detail,
      [single],
      [
        {
          entity: "todo",
          id: "1",
          delete: true,
        },
      ],
    ).reload,
    true,
  );
});

test("entities under maps, and props that are an entity themselves", () => {
  const byDay: EntityPath = {
    path: ["days", "{}", "[]"],
    entity: "todo",
    id: "id",
    properties: ["id", "done"],
  };
  const week = { days: { mon: [{ id: "1", done: false }], tue: [{ id: "2", done: false }] } };
  const { props: after } = applyChanges(
    week,
    [byDay],
    [
      {
        entity: "todo",
        id: "2",
        set: { done: true },
      },
    ],
  );
  assert.deepEqual(after.days.tue, [{ id: "2", done: true }]);
  assert.equal(after.days.mon, week.days.mon);

  const count: EntityPath = {
    path: [],
    entity: "todo-count",
    id: "id",
    properties: ["id", "left"],
  };
  const { props: summary } = applyChanges(
    { id: "me", left: 3 },
    [count],
    [
      {
        entity: "todo-count",
        id: "me",
        set: { left: 2 },
      },
    ],
  );
  assert.deepEqual(summary, { id: "me", left: 2 });
});

test("the entities an island holds, wherever its props hold them", () => {
  const count: EntityPath = {
    path: ["count"],
    entity: "todo-count",
    id: "id",
    properties: ["id", "left"],
  };
  const held = heldEntities({ ...props(), count: { id: "me", left: 2 } }, [todos, count]);

  assert.deepEqual(held, [
    { entity: "todo", id: "1" },
    { entity: "todo", id: "2" },
    { entity: "todo-count", id: "me" },
  ]);
  assert.deepEqual(heldEntities({ heading: "Todos" }, [todos, count]), [], "none there");
});
