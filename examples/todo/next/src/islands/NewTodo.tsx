"use client";

import { type IslandProps, useAction, useAppStrings } from "@client-compose/react";
import { type ChangeEvent, type FormEvent, useState } from "react";

import { AddTodoV1, AppStrings, type NewTodoV1 } from "../contract.generated";
import { addTodoProblem, titleProblem } from "./newTodoProblem";

/** A field for a new todo. It's checked before it's sent, and the composer checks it again. */
export function NewTodo(props: IslandProps<typeof NewTodoV1>) {
  const { maxLength, t } = props;
  const strings = useAppStrings(AppStrings);
  const addTodo = useAction(AddTodoV1);
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string>();

  function edit(event: ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value);
    setProblem(undefined);
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const before = titleProblem(t, title, maxLength);

    if (before) {
      setProblem(before);

      return;
    }

    const added = await addTodo.run({ title });

    if (added.status === "ok") {
      setTitle("");

      return;
    }

    setProblem(
      added.status === "error" ? addTodoProblem(t, added.error) : strings.somethingWentWrong,
    );
  }

  return (
    <form className="new-todo" onSubmit={add} noValidate>
      <label htmlFor="new-todo">{t.label}</label>
      <div className="row">
        <input
          id="new-todo"
          value={title}
          onChange={edit}
          placeholder={t.placeholder}
          aria-invalid={problem !== undefined}
          aria-describedby={problem ? "new-todo-problem" : undefined}
        />
        <button type="submit" disabled={addTodo.pending}>
          {t.add}
        </button>
      </div>
      {problem && (
        <p id="new-todo-problem" className="problem" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}
