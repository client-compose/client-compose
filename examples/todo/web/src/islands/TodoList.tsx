import type { IslandProps } from "@client-compose/react";

import type { TodoListV1 } from "../contract.generated.ts";
import { TodoItem } from "./TodoItem.tsx";

/** The todos, oldest first, or a word to say there are none. */
export function TodoList(props: IslandProps<typeof TodoListV1>) {
  const { todos, t } = props;

  if (todos.length === 0) {
    return <p className="empty">{t.empty}</p>;
  }

  return (
    <ul className="todos">
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} t={t} />
      ))}
    </ul>
  );
}
