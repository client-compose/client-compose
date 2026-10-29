// Islands a Server Component rendered, in the browser (spec §5.3): a Client Component island takes
// an action's changes and updates itself, and anything else asks for the server (`onChanges`).
import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ActionDescriptor,
  ActionEffects,
  HeldEntity,
  IslandDescriptor,
} from "@client-compose/protocol";
import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  type ActionState,
  ClientComposeProvider,
  ReactIslandRegistry,
  useAction,
} from "../src/index.ts";
import { IslandScope } from "../src/pages.ts";
import { ClientIsland, ServerIsland } from "../src/rendered.ts";
import { actionOk, createTestConfig, island } from "../src/testing.ts";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

interface TodosStrings {
  left: (values: { count: number }) => string;
}

const TodosV1: IslandDescriptor<{ todos: Todo[] }, TodosStrings> = {
  type: "todos",
  version: 1,
  strings: { left: ["count"] },
  entities: [
    {
      path: ["todos", "[]"],
      entity: "todo",
      id: "id",
      properties: ["id", "title", "done"],
    },
  ],
};
const DetailV1: IslandDescriptor<{ todo: Todo }> = {
  type: "detail",
  version: 1,
  entities: [
    {
      path: ["todo"],
      entity: "todo",
      id: "id",
      properties: ["id", "title", "done"],
    },
  ],
};

const Toggle: ActionDescriptor<Record<string, never>, Record<string, never>, never> = {
  action: "toggle",
  version: 1,
  errors: [],
  input: { type: "object" },
};

interface TodosProps {
  todos: Todo[];
  t: TodosStrings;
}

function Todos(props: TodosProps): ReactNode {
  const titles = props.todos.map((t) => `${t.title}${t.done ? "✓" : ""}`).join(",");
  const left = props.t.left({ count: props.todos.filter((t) => !t.done).length });

  return createElement("p", null, `${titles} (${left})`);
}

/** As the registry hands it over in a Server Component: props as plain data. */
function TodosIsland(props: object): ReactNode {
  return isTodosProps(props) ? createElement(Todos, props) : null;
}

function isTodosProps(props: object): props is TodosProps {
  return "todos" in props && "t" in props;
}

const milk: Todo = {
  id: "1",
  title: "Milk",
  done: false,
};
const eggs: Todo = {
  id: "2",
  title: "Eggs",
  done: false,
};
const strings = { left: { "#one": "{count} left", "#*": "{count} left" } };

/** The todos island as a Server Component renders it: its props and strings, in its scope. */
function todosIsland(todos: Todo[]): ReactNode {
  return createElement(
    IslandScope,
    {
      value: {
        screen: "todos",
        params: {},
        key: "todos",
        type: "todos",
        version: 1,
      },
    },
    createElement(ClientIsland, {
      component: TodosIsland,
      props: { todos },
      declared: { left: ["count"] },
      strings,
      plurals: { one: "i = 1 and v = 0" },
    }),
  );
}

/** A Server Component island holding these entities: what the server rendered, and a marker. */
function serverIsland(holds: HeldEntity[]): ReactNode {
  return createElement(
    IslandScope,
    {
      value: {
        screen: "detail",
        params: { id: "1" },
        key: "todo",
        type: "detail",
        version: 1,
      },
    },
    createElement(ServerIsland, { holds }, createElement("h1", null, "Milk")),
  );
}

/** Shows what a Server Component rendered, with a toggle action that answers with these effects. */
async function render(effects: ActionEffects, page: ReactNode) {
  const heard: ActionEffects[] = [];
  const held: { toggle?: ActionState<Record<string, never>, Record<string, never>, never> } = {};
  function Harness(): ReactNode {
    const toggle = useAction(Toggle);
    useEffect(() => {
      held.toggle = toggle;
    });
    return null;
  }
  const { config, gateway } = createTestConfig({
    registry: new ReactIslandRegistry().registerComponent(TodosV1, Todos),
    onChanges: (changed) => heard.push(changed),
    handlers: { actions: { toggle: () => actionOk(Toggle, {}, effects) } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const show = (content: ReactNode) =>
    act(async () =>
      root.render(
        createElement(ClientComposeProvider, { config }, createElement(Harness), content),
      ),
    );
  await show(page);

  return {
    container,
    heard,
    gateway,
    show,
    run: () => act(async () => void (await held.toggle?.run({}))),
    unmount: () => act(async () => root.unmount()),
  };
}

test("a Client Component island takes changes itself, without the server", async () => {
  const app = await render(
    {
      changes: [
        {
          entity: "todo",
          id: "2",
          set: { done: true },
        },
      ],
    },
    todosIsland([milk, eggs]),
  );
  assert.equal(app.container.textContent, "Milk,Eggs (2 left)");

  await app.run();

  assert.equal(app.container.textContent, "Milk,Eggs✓ (1 left)");
  assert.deepEqual(app.heard, [], "the server isn't asked");
  assert.equal(app.gateway.screenRequests().length, 0);
  await app.unmount();
});

test("a Client Component island takes its update, strings and all", async () => {
  const bread: Todo = {
    id: "3",
    title: "Bread",
    done: false,
  };
  const app = await render(
    {
      update: [
        {
          screen: "todos",
          params: {},
          island: island(
            "todos",
            TodosV1,
            { todos: [milk, eggs, bread] },
            { strings: { left: "{count} to go" } },
          ),
        },
      ],
    },
    todosIsland([milk, eggs]),
  );

  await app.run();

  assert.equal(app.container.textContent, "Milk,Eggs,Bread (3 to go)");
  assert.deepEqual(app.heard, []);
  await app.unmount();
});

test("an update a Client Component island can't show asks for the server", async () => {
  const update: ActionEffects = {
    update: [
      {
        screen: "todos",
        params: {},
        island: { ...island("todos", TodosV1, { todos: [] }), version: 2 },
      },
    ],
  };
  const app = await render(update, todosIsland([milk, eggs]));

  await app.run();

  assert.deepEqual(app.heard, [update]);
  assert.equal(app.container.textContent, "Milk,Eggs (2 left)", "it shows what it had until then");
  await app.unmount();
});

test("rendered again by the server, a Client Component island shows that", async () => {
  const app = await render(
    {
      changes: [
        {
          entity: "todo",
          id: "1",
          set: { done: true },
        },
      ],
    },
    todosIsland([milk, eggs]),
  );
  await app.run();
  assert.equal(app.container.textContent, "Milk✓,Eggs (1 left)");

  await app.show(todosIsland([eggs]));

  assert.equal(app.container.textContent, "Eggs (1 left)");
  await app.unmount();
});

test("a Server Component island asks for the server when changes touch what it holds", async () => {
  const touching: ActionEffects = {
    changes: [
      {
        entity: "todo",
        id: "1",
        set: { done: true },
      },
    ],
  };
  const app = await render(touching, serverIsland([{ entity: "todo", id: "1" }]));

  await app.run();

  assert.deepEqual(app.heard, [touching]);
  await app.unmount();

  const other = await render(
    {
      changes: [
        {
          entity: "todo",
          id: "2",
          set: { done: true },
        },
      ],
    },
    serverIsland([{ entity: "todo", id: "1" }]),
  );

  await other.run();

  assert.deepEqual(other.heard, [], "nothing it holds changed");
  await other.unmount();
});

test("a Server Component island asks for the server for its update", async () => {
  const update: ActionEffects = {
    update: [
      {
        screen: "detail",
        params: { id: "1" },
        island: island("todo", DetailV1, { todo: { ...milk, done: true } }),
      },
    ],
  };
  const app = await render(update, serverIsland([]));

  await app.run();

  assert.deepEqual(app.heard, [update]);
  await app.unmount();
});
