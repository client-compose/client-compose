// What every todo composer must do, checked over HTTP with the plain TypeScript client, so it runs
// against a composer in any language. Start one, then:
//
//   COMPOSER_URL=http://localhost:8080 pnpm test
//
// The tests share the composer's one list, so they run in order and each starts by emptying it.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  buildRequest,
  callAction,
  fetchScreen,
  fetchStrings,
  IslandRegistry,
} from "@client-compose/client";
import type { ClientContext, IslandDescriptor, ScreenResponse } from "@client-compose/protocol";

import {
  AddTodoV1,
  ClearCompletedV1,
  DeleteTodoV1,
  NewTodoV1,
  TodoListV1,
  TodoSummaryV1,
  ToggleTodoV1,
} from "./contract.generated.ts";

const COMPOSER_URL = process.env.COMPOSER_URL ?? "http://localhost:8080";

/** A client that can draw every island: it only reads their props. */
const registry = new IslandRegistry<unknown>()
  .register(NewTodoV1, (props) => props)
  .register(TodoListV1, (props) => props)
  .register(TodoSummaryV1, (props) => props);

function client(locale = "en"): ClientContext {
  return {
    platform: "test",
    appVersion: "1",
    locale,
  };
}

function todosScreen(locale?: string): Promise<ScreenResponse> {
  return fetchScreen(COMPOSER_URL, buildRequest(registry, "todos", client(locale)));
}

/** An island on a screen, by key, which must have resolved. */
function island(screen: ScreenResponse, key: string) {
  const entry = screen.islands.find((candidate) => candidate.key === key);

  if (entry?.status !== "ok") {
    throw new Error(`island ${key}: ${JSON.stringify(entry)}`);
  }

  return entry;
}

/** An island's props, typed by its descriptor (an app's registry does this as it renders). */
function props<Props>(
  screen: ScreenResponse,
  key: string,
  _island: IslandDescriptor<Props>,
): Props {
  return island(screen, key).props as Props;
}

/** The options every action is performed with. */
const asClient = { client: client() };

beforeEach(async () => {
  const screen = await todosScreen();
  const { todos } = props(screen, "list", TodoListV1);

  for (const todo of todos) {
    await callAction(COMPOSER_URL, DeleteTodoV1, { id: todo.id }, asClient);
  }
});

test("an empty list has no summary", async () => {
  const screen = await todosScreen();

  assert.deepEqual(
    screen.islands.map((entry) => entry.key),
    ["new", "list"],
  );

  assert.deepEqual(props(screen, "list", TodoListV1), { todos: [] });
  assert.equal(screen.meta?.title, "Todos");
});

test("todos are added, done, cleared and deleted, and each change reloads the screen", async () => {
  const milk = await callAction(COMPOSER_URL, AddTodoV1, { title: "Buy milk" }, asClient);
  const dog = await callAction(COMPOSER_URL, AddTodoV1, { title: "  Walk the dog  " }, asClient);
  assert.ok(milk.status === "ok" && dog.status === "ok");
  assert.deepEqual(milk.effects, { invalidate: [{ screen: "todos" }] });

  const milkId = milk.result.id;
  await callAction(COMPOSER_URL, ToggleTodoV1, { id: milkId, done: true }, asClient);

  const screen = await todosScreen();

  assert.deepEqual(props(screen, "list", TodoListV1), {
    todos: [
      {
        id: milkId,
        title: "Buy milk",
        done: true,
      },
      {
        id: dog.result.id,
        title: "Walk the dog",
        done: false,
      },
    ],
  });

  assert.deepEqual(props(screen, "summary", TodoSummaryV1), { left: 1, done: 1 });

  const cleared = await callAction(COMPOSER_URL, ClearCompletedV1, {}, asClient);
  assert.deepEqual(cleared.status === "ok" && cleared.result, { cleared: 1 });

  const after = await todosScreen();
  assert.deepEqual(props(after, "summary", TodoSummaryV1), { left: 1, done: 0 });
});

test("a new todo's title must say something, and not too much", async () => {
  const empty = await callAction(COMPOSER_URL, AddTodoV1, { title: "   " }, asClient);
  assert.deepEqual(empty.status === "error" && empty.error, { code: "empty_title" });

  const long = await callAction(COMPOSER_URL, AddTodoV1, { title: "a".repeat(101) }, asClient);

  assert.deepEqual(long.status === "error" && long.error, {
    code: "title_too_long",
    details: { maxLength: 100 },
  });
});

test("everything is in the client's language: the islands' words, the title and the app strings", async () => {
  await callAction(COMPOSER_URL, AddTodoV1, { title: "Kupić mleko" }, asClient);

  const screen = await todosScreen("pl-PL");
  assert.equal(screen.locale, "pl");
  assert.equal(screen.meta?.title, "Zadania");
  assert.equal(island(screen, "summary").strings?.clearCompleted, "Usuń zrobione");

  const strings = await fetchStrings(COMPOSER_URL, client("pl-PL"));
  assert.equal(strings.strings.retry, "Spróbuj ponownie");
});
