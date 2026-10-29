"use client";

import { type IslandProps, isUnexpected, useAction, useAppStrings } from "@client-compose/react";

import { AppStrings, ClearCompletedV1, type TodoSummaryV1 } from "../contract.generated";

/** How many are left ("1 item left", in the person's language), and a way to clear the done ones. */
export function TodoSummary(props: IslandProps<typeof TodoSummaryV1>) {
  const { left, done, t } = props;
  const strings = useAppStrings(AppStrings);
  const clearCompleted = useAction(ClearCompletedV1);

  async function clear() {
    await clearCompleted.run({});
  }

  return (
    <footer className="summary">
      <p>{t.left({ count: left })}</p>
      {done > 0 && (
        <button type="button" onClick={clear} disabled={clearCompleted.pending}>
          {t.clearCompleted}
        </button>
      )}
      {isUnexpected(clearCompleted.last) && (
        <p className="problem" role="alert">
          {strings.somethingWentWrong}
        </p>
      )}
    </footer>
  );
}
