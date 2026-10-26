// The browser half of `@client-compose/client/proxy`: sends screens and actions through your server
// (e.g. Next.js Server Actions wrapping a `createComposerProxy`) instead of to the composer.
//
//     const transport = viaProxy({ performAction: performGatewayAction, loadScreen: loadGatewayScreen });
//     const config = { registry, baseUrl: "", client, fetch: transport.fetch, performAction: transport.performAction };

import { ActionFetchError } from "@client-compose/client";
import type { ProxyResult } from "@client-compose/client/proxy";
import type { ActionRequest, ActionResponse, ScreenResponse } from "@client-compose/protocol";

import type { ClientComposeConfig } from "./config.ts";

export interface ProxyFunctions {
  /** Calls the server's `proxy.performAction`. */
  performAction: (request: ActionRequest) => Promise<ProxyResult<ActionResponse>>;
  /** Calls the server's `proxy.loadScreen`. Leave out if the browser never loads screens itself. */
  loadScreen?: (request: unknown) => Promise<ProxyResult<ScreenResponse>>;
}

export type ProxyTransport = Required<Pick<ClientComposeConfig, "fetch" | "performAction">>;

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

/** `fetch` and `performAction` for `ClientComposeConfig` that go through your server. */
export function viaProxy(proxy: ProxyFunctions): ProxyTransport {
  async function proxiedFetch(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!proxy.loadScreen) {
      throw new Error("viaProxy: no loadScreen given, so the browser can't load screens");
    }
    const result = await proxy.loadScreen(parseBody(init?.body));
    return result.ok
      ? Response.json(result.response)
      : new Response(result.body, { status: result.status });
  }

  async function performAction(request: ActionRequest): Promise<ActionResponse> {
    const result = await proxy.performAction(request);
    if (!result.ok) {
      throw new ActionFetchError(result.status, result.body);
    }
    return result.response;
  }

  return { fetch: proxiedFetch, performAction };
}
