// Configuration shared by the client binding and the Server Component entry. No React runtime
// imports here, so it's safe to import anywhere.

import type { ReactNode } from "react";
import type { IslandRegistry, SkipReason } from "@client-compose/client";
import type { ClientContext, IslandEntry } from "@client-compose/protocol";

export type ErrorEntry = IslandEntry & { status: "error" };

export interface ScreenConfig {
  registry: IslandRegistry<ReactNode>;
  /** Composer base URL; requests go to `${baseUrl}/screens/{screen}`. */
  baseUrl: string;
  client: ClientContext;
  /** Extra headers per request, e.g. `Authorization`. May be async (token refresh, reading cookies). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Extra options for every screen request, e.g. `{ cache: "no-store" }`, or a framework's own
   * fetch options such as Next.js's `{ next: { revalidate: 30 } }`.
   */
  requestInit?: RequestInit & Record<string, unknown>;
  /** Render a fallback for islands the composer marked as errored. Default: omit them. */
  renderIslandError?: (entry: ErrorEntry) => ReactNode;
  /** Islands the client couldn't render (unknown type, version or status). */
  onSkipped?: (entry: IslandEntry, reason: SkipReason) => void;
  /** An island threw while rendering. The island is hidden; the rest of the screen stays. */
  onRenderError?: (key: string, error: unknown) => void;
}

export interface ClientComposeConfig extends ScreenConfig {
  /** Reuse responses for `cache.maxAge` seconds, as the composer allows. Default: true. */
  cache?: boolean;
}
