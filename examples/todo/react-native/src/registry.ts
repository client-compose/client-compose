import { ReactIslandRegistry } from "@client-compose/react";

import { NewTodoV1, TodoListV1, TodoSummaryV1 } from "./contract.generated";
import { NewTodo } from "./islands/NewTodo";
import { TodoList } from "./islands/TodoList";
import { TodoSummary } from "./islands/TodoSummary";

/** The islands this app can draw. The composer sends only these, at versions the app knows. */
export const registry = new ReactIslandRegistry()
  .registerComponent(NewTodoV1, NewTodo)
  .registerComponent(TodoListV1, TodoList)
  .registerComponent(TodoSummaryV1, TodoSummary);
