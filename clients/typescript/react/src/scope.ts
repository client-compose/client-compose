// Where an island is: plain data, with no React, so the client and the Server Component entry
// (which may only render components from "use client" modules) can both work it out.

import type { ScreenResponse } from "@client-compose/protocol";

/** Where an island is: its screen and the screen's params, its key and version, and its `next`. */
export interface IslandScopeValue {
  screen: string;
  params: Record<string, string>;
  key: string;
  version: number;
  next?: string;
}

/** Where a screen's island is, if it resolved; islands that failed have no pages. */
export function scopeOf(
  response: ScreenResponse,
  params: Record<string, string>,
  key: string,
): IslandScopeValue | undefined {
  const entry = response.islands.find((e) => e.key === key);
  if (entry?.status !== "ok") {
    return undefined;
  }
  return {
    screen: response.screen,
    params,
    key: entry.key,
    version: entry.version,
    ...(entry.next !== undefined && { next: entry.next }),
  };
}
