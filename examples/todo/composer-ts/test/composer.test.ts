// The shared suite in ../tests checks this composer over HTTP, as it does every todo composer.
// These tests check the same things in-process, with the composer's test kit.
import assert from "node:assert/strict";
import { test } from "node:test";

import { loadCatalog } from "@client-compose/composer";
import { testComposer } from "@client-compose/composer/testing";

import { createTodoComposer } from "../src/composer.ts";
import { AddTodoV1, TodoListV1, TodoSummaryV1 } from "../src/contract.generated.ts";
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

  for (const title of ["Buy milk", "  Walk the dog  "]) {
    const added = await app.perform(AddTodoV1, { title });
    assert.equal(added.status, "ok");
    assert.deepEqual(added.effects, { invalidate: [{ screen: "todos" }] });
  }

  const screen = await app.screen("todos");

  assert.deepEqual(
    screen.props(TodoListV1, "list").todos.map((todo) => todo.title),
    ["Buy milk", "Walk the dog"],
  );

  assert.deepEqual(screen.props(TodoSummaryV1, "summary"), { left: 2, done: 0 });
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
