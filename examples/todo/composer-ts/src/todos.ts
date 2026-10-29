// The todos, kept in memory: a stand-in for your database or service.

/** The longest title a todo can have, in characters. */
export const MAX_TITLE_LENGTH = 100;

export interface Todo {
  id: string;
  title: string;
  done: boolean;
}

/** What's wrong with a todo's title, if anything. */
export type TitleProblem = "empty" | "too_long" | undefined;

/** Whether a title can be added. */
export function checkTitle(title: string): TitleProblem {
  const trimmed = title.trim();

  if (trimmed === "") {
    return "empty";
  }

  if ([...trimmed].length > MAX_TITLE_LENGTH) {
    return "too_long";
  }

  return undefined;
}

export class Todos {
  private todos: Todo[] = [];
  private nextId = 0;

  /** The todos, oldest first. */
  all(): Todo[] {
    return [...this.todos];
  }

  /** Adds a todo with this title, trimmed. It doesn't check the title: see checkTitle. */
  add(title: string): Todo {
    this.nextId++;

    const todo = {
      id: String(this.nextId),
      title: title.trim(),
      done: false,
    };

    this.todos.push(todo);

    return todo;
  }

  /** Marks a todo done, or not done. A todo that isn't there is left alone. */
  setDone(id: string, done: boolean): void {
    this.todos = this.todos.map((todo) => (todo.id === id ? { ...todo, done } : todo));
  }

  /** Deletes a todo. One that isn't there is left alone. */
  delete(id: string): void {
    this.todos = this.todos.filter((todo) => todo.id !== id);
  }

  /** Deletes every todo that's done, and returns how many it deleted. */
  clearDone(): number {
    const before = this.todos.length;
    this.todos = this.todos.filter((todo) => !todo.done);

    return before - this.todos.length;
  }
}
