import { type Catalog, createComposer, reportErrors } from "@client-compose/composer";

import { todoActions } from "./actions.ts";
import { todosScreen } from "./screen.ts";
import type { Todos } from "./todos.ts";

/**
 * Serves the todos screen and its actions, in each client's language. `Req` is your server's
 * request type: a fetch `Request` by default, or node:http's `IncomingMessage` (main.ts).
 */
export function createTodoComposer<Req = Request>(todos: Todos, catalog: Catalog) {
  return createComposer<undefined, Req>({
    screens: [todosScreen(todos)],
    actions: todoActions(todos),
    strings: { catalog, defaultLocale: "en" },
    use: [reportErrors((failure) => console.error(`${failure.kind} failed:`, failure.error))],
  });
}
