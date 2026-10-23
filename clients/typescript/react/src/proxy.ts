// The browser half of `@client-compose/client/proxy`: sends screens and actions through your server
// (e.g. Next.js Server Actions wrapping a `createComposerProxy`) instead of to the composer.
//
//     const transport = viaProxy({ performAction: performGatewayAction, loadScreen: loadGatewayScreen });
//     const config = { registry, baseUrl: "", client, fetch: transport.fetch, performAction: transport.performAction };

import { ActionFetchError } from "@client-compose/client";
import type { ProxyResult } from "@client-compose/client/proxy";
import type {
  ActionRequest,
  ActionResponse,
  IslandEntry,
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

export type ProxyTransport = Required<Pick<ClientComposeConfig, "fetch" | "performAction">>;

function parseBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** `fetch` and `performAction` for `ClientComposeConfig` that go through your server. */
export function viaProxy(proxy: ProxyFunctions): ProxyTransport {
  async function proxiedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/screens\/[^/]+\/islands\//.test(url)) {
      if (!proxy.loadIsland)
        throw new Error("viaProxy: no loadIsland given, so islands can't load their pages");
      const body = parseBody(init?.body);
      const result = await proxy.loadIsland(body);
      const screen = (body as { screen?: unknown } | undefined)?.screen;
      // As the composer answers, so fetchIsland reads it the same way.
      return result.ok
        ? Response.json({ protocol: 0, screen, island: result.response })
        : new Response(result.body, { status: result.status });
    }
    if (!proxy.loadScreen)
      throw new Error("viaProxy: no loadScreen given, so the browser can't load screens");
    const result = await proxy.loadScreen(parseBody(init?.body));
    return result.ok
      ? Response.json(result.response)
      : new Response(result.body, { status: result.status });
  }

  async function performAction(request: ActionRequest): Promise<ActionResponse> {
    const result = await proxy.performAction(request);
    if (!result.ok) throw new ActionFetchError(result.status, result.body);
    return result.response;
  }

  return { fetch: proxiedFetch, performAction };
}
