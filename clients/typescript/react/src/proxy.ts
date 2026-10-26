// The browser half of `@client-compose/client/proxy`: sends screens, islands' pages and actions
// through your server (e.g. Next.js Server Actions wrapping a `createComposerProxy`) instead of to
// the composer.
//
//     const transport = viaProxy({ performAction, loadScreen, loadIsland });
//     const config = { registry, baseUrl: "", client, ...transport };

import { ActionFetchError, IslandFetchError, screenLines } from "@client-compose/client";
import type { ProxyResult } from "@client-compose/client/proxy";
import type {
  ActionRequest,
  ActionResponse,
  IslandEntry,
  IslandRequest,
  ScreenResponse,
} from "@client-compose/protocol";

import type { ClientComposeConfig } from "./config.ts";

export interface ProxyFunctions {
  /** Calls the server's `proxy.performAction`. */
  performAction: (request: ActionRequest) => Promise<ProxyResult<ActionResponse>>;
  /** Calls the server's `proxy.loadScreen`. Leave out if the browser never loads screens itself. */
  loadScreen?: (request: unknown) => Promise<ProxyResult<ScreenResponse>>;
  /**
   * Calls the server's `proxy.loadIsland`, for islands' next pages (usePages). Leave out if no
   * island loads pages.
   */
  loadIsland?: (request: unknown) => Promise<ProxyResult<IslandEntry>>;
}

/** What a config needs to go through your server: spread it into the config. */
export type ProxyTransport = Required<Pick<ClientComposeConfig, "fetch" | "performAction">> &
  Pick<ClientComposeConfig, "loadIsland">;

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * `fetch`, `performAction` and (given `loadIsland`) `loadIsland` for `ClientComposeConfig`, going
 * through your server.
 */
export function viaProxy(proxy: ProxyFunctions): ProxyTransport {
  async function proxiedFetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!proxy.loadScreen) {
      throw new Error("viaProxy: no loadScreen given, so the browser can't load screens");
    }
    const result = await proxy.loadScreen(parseBody(init?.body));
    // Your server reads the screen to its end, so it comes as one head and an end (spec §4.6).
    return result.ok
      ? new Response(screenLines(result.response), {
          headers: { "content-type": "application/jsonl" },
        })
      : new Response(result.body, { status: result.status });
  }

  async function performAction(request: ActionRequest): Promise<ActionResponse> {
    const result = await proxy.performAction(request);
    if (!result.ok) {
      throw new ActionFetchError(result.status, result.body);
    }
    return result.response;
  }

  const serverLoadIsland = proxy.loadIsland;
  async function loadIsland(request: IslandRequest): Promise<IslandEntry> {
    if (!serverLoadIsland) {
      throw new Error("viaProxy: no loadIsland given, so islands can't load their pages");
    }
    const result = await serverLoadIsland(request);
    if (!result.ok) {
      throw new IslandFetchError(result.status, result.body);
    }
    return result.response;
  }

  return {
    fetch: proxiedFetch,
    performAction,
    ...(serverLoadIsland && { loadIsland }),
  };
}
