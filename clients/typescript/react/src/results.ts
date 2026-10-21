// Reading how an action call ended, for showing its errors.

import type { DeclaredError } from "@client-compose/protocol";
import type { ActionResult } from "./client.ts";

/** The declared error an action call ended with, if that's how it ended. */
export function declaredError<E extends DeclaredError>(result: ActionResult<unknown, E> | undefined): E | undefined {
  return result?.status === "error" ? result.error : undefined;
}

/**
 * Whether an action call ended in a way the app doesn't show specifically: the call failed (no
 * connection, the composer down, `unauthenticated`), or it ended with a declared error not in
 * `handled`, such as a code added after this app was built. Show a generic "something went wrong".
 *
 *     {isUnexpected(follow.last, ["blocked"]) && <Notice>Something went wrong</Notice>}
 */
export function isUnexpected<E extends DeclaredError>(
  result: ActionResult<unknown, E> | undefined,
  handled: readonly E["code"][] = [],
): boolean {
  if (result?.status === "failed") return true;
  return result?.status === "error" && !handled.includes(result.error.code);
}
