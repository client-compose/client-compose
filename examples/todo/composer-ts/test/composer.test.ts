// The shared suite in ../tests checks this composer over HTTP, as it does every todo composer.
// These tests check the same things in-process, with the composer's test kit.
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadCatalog } from "@client-compose/composer";
import { testComposer } from "@client-compose/composer/testing";

import { createTodoComposer } from "../src/composer.ts";
import {
  AddTodoV1,
  ClearCompletedV1,
  DeleteTodoV1,
  TodoListV1,
  TodoSummaryV1,
  ToggleTodoV1,
} from "../src/contract.generated.ts";
import { MAX_TITLE_LENGTH, Todos } from "../src/todos.ts";

const catalog = loadCatalog(new URL("../../strings", import.meta.url).pathname);

function newApp(locale = "en") {
  return testComposer(createTodoComposer(new Todos(), catalog), {
    client: {
      platform: "test",
      appVersion: "1",
      locale,
    },
  });
}

test("an empty list has no summary", async () => {
  const app = newApp();

  const screen = await app.screen("todos");

  assert.deepEqual(screen.keys(), ["new", "list"]);
});

test("adding todos counts what's left", async () => {
  const app = newApp();

  // The first brings the summary, so the screen reloads; the next joins the list.
  const first = await app.perform(AddTodoV1, { title: "Buy milk" });
  assert.deepEqual(first.effects, { invalidate: [{ screen: "todos" }] });
  const second = await app.perform(AddTodoV1, { title: "  Walk the dog  " });
  assert.deepEqual(
    second.effects?.update?.map((u) => u.island.key),
    ["list"],
  );

  const screen = await app.screen("todos");

  assert.deepEqual(
    screen.props(TodoListV1, "list").todos.map((todo) => todo.title),
    ["Buy milk", "Walk the dog"],
  );

  assert.deepEqual(screen.props(TodoSummaryV1, "summary"), {
    id: "all",
    left: 2,
    done: 0,
  });
});

test("a title must say something, and not too much", async () => {
  const app = newApp();

  const empty = await app.perform(AddTodoV1, { title: "   " });
  assert.equal(empty.error?.code, "empty_title");

  const long = await app.perform(AddTodoV1, { title: "a".repeat(MAX_TITLE_LENGTH + 1) });

  assert.deepEqual(long.error, {
    code: "title_too_long",
    details: { maxLength: MAX_TITLE_LENGTH },
  });
});

test("the screen is in the client's language", async () => {
  const app = newApp("pl-PL");

  const screen = await app.screen("todos");

  assert.equal(screen.head?.meta?.title, "Zadania");
});

// Every action says what it changed, and nothing it forgot: applied to the screen as an app would,
// its effects match the screen composed again.
test("each action says everything it changed", async () => {
  const app = newApp();

  const milk = await app.checkEffects("todos", {}, () =>
    app.perform(AddTodoV1, { title: "Buy milk" }),
  );
  await app.checkEffects("todos", {}, () => app.perform(AddTodoV1, { title: "Walk the dog" }));
  await app.checkEffects("todos", {}, () =>
    app.perform(ToggleTodoV1, { id: milk.result?.id ?? "", done: true }),
  );
  await app.checkEffects("todos", {}, () => app.perform(ClearCompletedV1, {}));
  const [dog] = (await app.screen("todos")).props(TodoListV1, "list").todos;
  await app.checkEffects("todos", {}, () => app.perform(DeleteTodoV1, { id: dog?.id ?? "" }));
});
