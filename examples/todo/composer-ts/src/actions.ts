import { action } from "@client-compose/composer";

import { AddTodoV1, ClearCompletedV1, DeleteTodoV1, ToggleTodoV1 } from "./contract.generated.ts";
import { checkTitle, MAX_TITLE_LENGTH, type Todos } from "./todos.ts";

/** Tells apps the todos screen changed, so the one on show reloads. */
const changedTodos = { invalidate: [{ screen: "todos" }] };

export function todoActions(todos: Todos) {
  const addTodo = action(AddTodoV1, ({ title }) => {
    const problem = checkTitle(title);

    if (problem === "empty") {
      return { error: { code: "empty_title" } };
    }

    if (problem === "too_long") {
      return { error: { code: "title_too_long", details: { maxLength: MAX_TITLE_LENGTH } } };
    }

    const todo = todos.add(title);

    return { result: { id: todo.id }, effects: changedTodos };
  });

  const toggleTodo = action(ToggleTodoV1, ({ id, done }) => {
    todos.setDone(id, done);

    return { result: {}, effects: changedTodos };
  });

  const deleteTodo = action(DeleteTodoV1, ({ id }) => {
    todos.delete(id);

    return { result: {}, effects: changedTodos };
  });

  const clearCompleted = action(ClearCompletedV1, () => {
    const cleared = todos.clearDone();

    return { result: { cleared }, effects: changedTodos };
  });

  return [addTodo, toggleTodo, deleteTodo, clearCompleted];
}
