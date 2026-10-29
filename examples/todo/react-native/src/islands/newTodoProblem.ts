import type { AddTodoV1Error, NewTodoV1Strings } from "../contract.generated";

/** What's wrong with a title before it's sent, in the same words the composer's errors get. */
export function titleProblem(
  t: NewTodoV1Strings,
  title: string,
  maxLength: number,
): string | undefined {
  const trimmed = title.trim();

  if (trimmed === "") {
    return t.emptyTitle;
  }

  if ([...trimmed].length > maxLength) {
    return t.titleTooLong({ maxLength });
  }

  return undefined;
}

/** What the composer's answer means, when it said no. */
export function addTodoProblem(t: NewTodoV1Strings, error: AddTodoV1Error): string {
  switch (error.code) {
    case "empty_title":
      return t.emptyTitle;
    case "title_too_long":
      return t.titleTooLong({ maxLength: error.details.maxLength });
  }
}
