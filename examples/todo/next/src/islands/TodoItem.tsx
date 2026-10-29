"use client";

import { isUnexpected, useAction, useAppStrings } from "@client-compose/react";

import {
  AppStrings,
  DeleteTodoV1,
  type TodoListV1Strings,
  type TodoListV1Todo,
  ToggleTodoV1,
} from "../contract.generated";

export interface TodoItemProps {
  todo: TodoListV1Todo;
  t: TodoListV1Strings;
}

/** One todo: a checkbox that marks it done, and a button that deletes it. */
export function TodoItem(props: TodoItemProps) {
  const { todo, t } = props;
  const strings = useAppStrings(AppStrings);
  const toggleTodo = useAction(ToggleTodoV1);
  const deleteTodo = useAction(DeleteTodoV1);
  const failed = isUnexpected(toggleTodo.last) || isUnexpected(deleteTodo.last);

  async function toggle() {
    await toggleTodo.run({ id: todo.id, done: !todo.done });
  }

  async function remove() {
    await deleteTodo.run({ id: todo.id });
  }

  return (
    <li className={todo.done ? "todo done" : "todo"}>
      <input
        type="checkbox"
        checked={todo.done}
        onChange={toggle}
        disabled={toggleTodo.pending}
        aria-label={t.markDone({ title: todo.title })}
      />
      <span className="title">{todo.title}</span>
      <button
        type="button"
        onClick={remove}
        disabled={deleteTodo.pending}
        aria-label={t.deleteLabel({ title: todo.title })}
      >
        {t.delete}
      </button>
      {failed && (
        <p className="problem" role="alert">
          {strings.somethingWentWrong}
        </p>
      )}
    </li>
  );
}
