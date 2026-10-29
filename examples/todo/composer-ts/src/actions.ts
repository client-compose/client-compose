import { action, changed, deleted, type Effects } from "@client-compose/composer";

import {
  AddTodoV1,
  ClearCompletedV1,
  DeleteTodoV1,
  TodoCountsEntity,
  TodoEntity,
  ToggleTodoV1,
} from "./contract.generated.ts";
import { checkTitle, COUNTS_ID, MAX_TITLE_LENGTH, type Todos } from "./todos.ts";

// Each action says what it changed as narrowly as it can (spec §5.3): the todos and counts it
// changed, the list when a new todo joins it, and the whole screen only when the summary appears or
// goes, because the list became empty or stopped being empty.

/** The todos screen, which every action changes. */
const screen = { screen: "todos" };

/** The change to the list's counts, after an action. */
function counted(todos: Todos) {
  return changed(TodoCountsEntity, COUNTS_ID, todos.counts());
}

/** The screen to reload when an action left the list empty: the summary goes. */
function emptied(todos: Todos, effects: Effects): Effects {
  return todos.all().length === 0 ? { invalidate: [screen] } : effects;
}

export function todoActions(todos: Todos) {
  const addTodo = action(AddTodoV1, ({ title }) => {
    const problem = checkTitle(title);
    if (problem === "empty") {
      return { error: { code: "empty_title" } };
    }

    if (problem === "too_long") {
      return { error: { code: "title_too_long", details: { maxLength: MAX_TITLE_LENGTH } } };
    }

    const first = todos.all().length === 0;
    const todo = todos.add(title);

    // The first todo brings the summary with it.
    if (first) {
      return { result: { id: todo.id }, effects: { invalidate: [screen] } };
    }

    return {
      result: { id: todo.id },
      effects: { changes: [counted(todos)], update: [{ ...screen, key: "list" }] },
    };
  });

  const toggleTodo = action(ToggleTodoV1, ({ id, done }) => {
    todos.setDone(id, done);

    return {
      result: {},
      effects: { changes: [changed(TodoEntity, id, { done }), counted(todos)] },
    };
  });

  const deleteTodo = action(DeleteTodoV1, ({ id }) => {
    todos.delete(id);

    return {
      result: {},
      effects: emptied(todos, { changes: [deleted(TodoEntity, id), counted(todos)] }),
    };
  });

  const clearCompleted = action(ClearCompletedV1, () => {
    const done = todos.all().filter((todo) => todo.done);
    const cleared = todos.clearDone();
    const changes = [...done.map((todo) => deleted(TodoEntity, todo.id)), counted(todos)];

    return { result: { cleared }, effects: emptied(todos, { changes }) };
  });

  return [addTodo, toggleTodo, deleteTodo, clearCompleted];
}
