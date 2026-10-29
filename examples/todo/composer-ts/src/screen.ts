import { island, place, placeStatic, screen } from "@client-compose/composer";

import { NewTodoV1, TodoListV1, TodosScreenStrings, TodoSummaryV1 } from "./contract.generated.ts";
import { MAX_TITLE_LENGTH, type Todos } from "./todos.ts";

/**
 * The one screen: a field for a new todo, the list, and a summary while there's anything in it.
 */
export function todosScreen(todos: Todos) {
  const list = island(TodoListV1, () => ({ todos: todos.all() }));

  const summary = island(TodoSummaryV1, () => {
    const done = todos.all().filter((todo) => todo.done).length;

    return { left: todos.all().length - done, done };
  });

  return screen("todos", {
    islands: [
      placeStatic("new", NewTodoV1, { maxLength: MAX_TITLE_LENGTH }),
      place("list", list, { required: true }),
      place("summary", summary, { when: () => todos.all().length > 0 }),
    ],
    meta: (lc) => ({ title: lc.strings(TodosScreenStrings).title }),
  });
}
