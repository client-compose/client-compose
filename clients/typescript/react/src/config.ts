// Configuration shared by the client binding and the Server Component entry. No React runtime
// imports here, so it's safe to import anywhere.

import type { IslandRegistry, SkipReason } from "@client-compose/client";
import type {
  ActionRequest,
  ActionResponse,
  ClientContext,
  IslandEntry,
  IslandRequest,
  ScreenRef,
  StringsResponse,
} from "@client-compose/protocol";
import type { ReactNode } from "react";

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
  /**
   * Show each screen as its stream arrives (spec §4.6): its islands once its head does, with a
   * placeholder (or nothing) for each still pending, filled in as they come. Set false to wait for
   * the whole screen and show it at once. `useScreen` and `<ComposedScreen>` can say otherwise per
   * screen. Default: true.
   */
  progressive?: boolean;
}

export interface ClientComposeConfig extends ScreenConfig {
  /** Reuse responses for `cache.maxAge` seconds, as the composer allows. Default: true. */
  cache?: boolean;
  /**
   * Send action requests some other way than POSTing them to `${baseUrl}/actions/{action}`, e.g.
   * through a Next.js Server Action so that session cookies stay on the server. Resolve with the
   * composer's 200 response; throw (e.g. `ActionFetchError`) for anything else.
   */
  performAction?: (request: ActionRequest) => Promise<ActionResponse>;
  /**
   * Send island requests (islands' next pages, `usePages`) some other way than POSTing them to
   * `${baseUrl}/screens/{screen}/islands/{key}`, e.g. through your server (`viaProxy`). Resolve
   * with the island's entry; throw (e.g. `IslandFetchError`) for anything else.
   */
  loadIsland?: (request: IslandRequest) => Promise<IslandEntry>;
  /**
   * Fetch the app strings (`<AppStringsProvider>`) some other way than POSTing to
   * `${baseUrl}/strings`, e.g. through your server (`viaProxy`).
   */
  loadStrings?: () => Promise<StringsResponse>;
  /** An action suggested a screen to show next (spec §5.3). Map it to your router. */
  onNavigate?: (ref: ScreenRef) => void;
  /**
   * An action changed these screens (spec §5.3). Screens shown with `useScreen`/`<ComposedScreen>`
   * reload by themselves; use this for anything else, e.g. `router.refresh()` to re-render Server
   * Components.
   */
  onInvalidate?: (refs: ScreenRef[]) => void;
}
