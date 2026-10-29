// The islands this app can draw. Each is a Client Component ("use client"): they perform actions,
// and their strings (`t`) are built in the browser.
import { ReactIslandRegistry } from "@client-compose/react";

import { NewTodoV1, TodoListV1, TodoSummaryV1 } from "./contract.generated";
import { NewTodo } from "./islands/NewTodo";
import { TodoList } from "./islands/TodoList";
import { TodoSummary } from "./islands/TodoSummary";

export const registry = new ReactIslandRegistry()
  .registerComponent(NewTodoV1, NewTodo)
  .registerComponent(TodoListV1, TodoList)
  .registerComponent(TodoSummaryV1, TodoSummary);
