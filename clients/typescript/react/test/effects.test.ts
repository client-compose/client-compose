// An action's entity changes and island updates (spec §5.3), applied to the screens the app has:
// on show, cached, and the pages a paged island holds.
import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor, ActionEffects, IslandDescriptor } from "@client-compose/protocol";
import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  type ActionState,
  ClientComposeProvider,
  ComposedScreen,
  ReactIslandRegistry,
  useAction,
  usePages,
} from "../src/index.ts";
import {
  actionOk,
  createTestConfig,
  type FakeGatewayHandlers,
  island,
  islandResponse,
  screen,
} from "../src/testing.ts";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

// As codegen generates them: a list of todos, and how many are left.
const TodosV1: IslandDescriptor<{ todos: Todo[] }> = {
  type: "todos",
  version: 1,
  entities: [
    {
      path: ["todos", "[]"],
      entity: "todo",
      id: "id",
      properties: ["id", "title", "done"],
    },
  ],
};
const LeftV1: IslandDescriptor<{ id: string; left: number }> = {
  type: "left",
  version: 1,
  entities: [
    {
      path: [],
      entity: "todo-count",
      id: "id",
      properties: ["id", "left"],
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

function Todos(props: { todos: Todo[] }): ReactNode {
  const pages = usePages(props);
  const todos = pages.pages.flatMap((page) => page.todos);
  const list = createElement(
    "ul",
    null,
    todos.map((t) => `${t.title}${t.done ? "✓" : ""}`).join(","),
  );
  const more =
    pages.status === "more" && createElement("button", { onClick: pages.loadMore }, "more");

  return createElement("div", null, list, more);
}

const registry = new ReactIslandRegistry()
  .registerComponent(TodosV1, Todos)
  .registerComponent(LeftV1, ({ left }) => createElement("p", null, `${left} left`))
  .registerComponent(DetailV1, ({ todo }) => createElement("h1", null, todo.title));

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

const todosScreen = (todos: Todo[] = [milk, eggs], next?: string) =>
  screen("todos", [
    island("todos", TodosV1, { todos }, next),
    island("left", LeftV1, { id: "me", left: todos.filter((t) => !t.done).length }),
  ]);

/** Shows `screens` with a fake composer whose toggle action answers with these effects. */
async function render(effects: ActionEffects, handlers: FakeGatewayHandlers = {}, cache = false) {
  const held: { toggle?: ActionState<Record<string, never>, Record<string, never>, never> } = {};
  function Harness(): ReactNode {
    const toggle = useAction(Toggle);
    useEffect(() => {
      held.toggle = toggle;
    });
    return null;
  }
  const { config, gateway } = createTestConfig({
    registry,
    cache,
    handlers: {
      screens: {
        todos: () => todosScreen(),
        detail: () => screen("detail", [island("todo", DetailV1, { todo: milk })]),
      },
      actions: { toggle: () => actionOk(Toggle, {}, effects) },
      ...handlers,
    },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const show = (screens: string[]) =>
    act(async () =>
      root.render(
        createElement(
          ClientComposeProvider,
          { config },
          createElement(Harness),
          ...screens.map((s) => createElement(ComposedScreen, { key: s, screen: s })),
        ),
      ),
    );
  await show(["todos"]);

  return {
    container,
    gateway,
    show,
    run: () => act(async () => void (await held.toggle?.run({}))),
    fetches: (id: string) => gateway.screenRequests().filter((r) => r.screen === id).length,
    unmount: () => act(async () => root.unmount()),
  };
}

test("changes reach every island showing the entity, without asking for the screen again", async () => {
  const app = await render({
    changes: [
      {
        entity: "todo",
        id: "2",
        set: { done: true },
      },
      {
        entity: "todo-count",
        id: "me",
        set: { left: 1 },
      },
    ],
  });
  assert.equal(app.container.textContent, "Milk,Eggs2 left");

  await app.run();

  assert.equal(app.container.textContent, "Milk,Eggs✓1 left");
  assert.equal(app.fetches("todos"), 1);
  await app.unmount();
});

test("an update swaps an island's entry in, and the rest of the screen stays", async () => {
  const bread: Todo = {
    id: "3",
    title: "Bread",
    done: false,
  };
  const app = await render({
    update: [
      {
        screen: "todos",
        params: {},
        island: island("todos", TodosV1, { todos: [milk, eggs, bread] }),
      },
    ],
  });

  await app.run();

  assert.equal(app.container.textContent, "Milk,Eggs,Bread2 left");
  assert.equal(app.fetches("todos"), 1);
  await app.unmount();
});

test("a screen that can't take its changes or updates is asked for again", async () => {
  const unknownIsland = await render({
    update: [
      {
        screen: "todos",
        params: {},
        island: island("summary", LeftV1, { id: "me", left: 0 }),
      },
    ],
  });
  await unknownIsland.run();
  assert.equal(unknownIsland.fetches("todos"), 2);
  await unknownIsland.unmount();

  // A deleted todo shown on its own, not in a list, can't be removed: its screen reloads.
  const deletedDetail = await render({
    changes: [
      {
        entity: "todo",
        id: "1",
        delete: true,
      },
    ],
  });
  await deletedDetail.show(["todos", "detail"]);
  await deletedDetail.run();
  assert.equal(deletedDetail.fetches("detail"), 2);
  assert.equal(deletedDetail.fetches("todos"), 1, "the list removes it in place");
  assert.equal(deletedDetail.container.querySelector("ul")?.textContent, "Eggs");
  await deletedDetail.unmount();
});

test("a cached screen takes the changes too, so it shows them when it's opened again", async () => {
  const cached = {
    locale: "en",
    plurals: {},
    cache: { maxAge: 60 },
  };
  const app = await render(
    {
      changes: [
        {
          entity: "todo",
          id: "1",
          set: { title: "Oat milk" },
        },
      ],
    },
    {
      screens: {
        todos: () =>
          screen("todos", [island("todos", TodosV1, { todos: [milk] })], undefined, cached),
      },
    },
    true,
  );
  await app.show([]);

  await app.run();
  await app.show(["todos"]);

  assert.equal(app.container.textContent, "Oat milk");
  assert.equal(app.fetches("todos"), 1);
  await app.unmount();
});

test("changes reach every page a paged island holds, and it keeps them", async () => {
  const app = await render(
    {
      changes: [
        {
          entity: "todo",
          id: "1",
          set: { done: true },
        },
        {
          entity: "todo",
          id: "3",
          set: { done: true },
        },
      ],
    },
    {
      screens: { todos: () => todosScreen([milk, eggs], "p2") },
      islands: {
        "todos/todos": () =>
          islandResponse(
            "todos",
            island("todos", TodosV1, {
              todos: [
                {
                  id: "3",
                  title: "Bread",
                  done: false,
                },
              ],
            }),
          ),
      },
    },
  );
  // The second page, as scrolling to the end would load it.
  await act(async () => app.container.querySelector("button")?.click());
  assert.equal(app.container.querySelector("ul")?.textContent, "Milk,Eggs,Bread");

  await app.run();

  assert.equal(app.container.querySelector("ul")?.textContent, "Milk✓,Eggs,Bread✓");
  assert.equal(
    app.gateway.islandRequests().length,
    1,
    "it kept its pages, rather than starting again",
  );
  await app.unmount();
});

test("an action request says which islands the app can draw", async () => {
  const app = await render({});

  await app.run();

  assert.deepEqual(app.gateway.actionRequests()[0]?.body, {
    ...(app.gateway.actionRequests()[0]?.body as object),
    islands: {
      todos: [1],
      left: [1],
      detail: [1],
    },
  });
  await app.unmount();
});
