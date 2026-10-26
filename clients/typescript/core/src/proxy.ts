// Passing a browser's screen and action requests to the composer through your own server, e.g. a
// Next.js Server Action or a Remix action. The server adds what the browser mustn't hold (a session
// kept in an httpOnly cookie) and vouches for the client context, so the browser's is ignored.
//
//     const proxy = createComposerProxy({
//       baseUrl: COMPOSER_URL,
//       client: async () => ({ platform: "web", appVersion, locale: await getLocale() }),
//       headers: async () => ({ Authorization: `Bearer ${await getSessionToken()}` }),
//     });
//     export async function performAction(body: unknown) { return proxy.performAction(body); }
//
// Anyone can call a server endpoint with anything, so requests are checked before they're sent on.
// Errors come back as data, since frameworks often strip thrown errors' details on the way to the
// browser.

import {
  type ActionRequest,
  type ActionResponse,
  type Capabilities,
  type ClientContext,
  type IslandEntry,
  type IslandRequest,
  PROTOCOL_VERSION,
  type ScreenRequest,
  type ScreenResponse,
} from "@client-compose/protocol";

import {
  ActionFetchError,
  fetchAction,
  fetchIsland,
  fetchScreen,
  IslandFetchError,
  ScreenFetchError,
} from "./index.ts";

/** A screen request from the browser: the server sets the client context. */
export type ProxiedScreenRequest = Omit<ScreenRequest, "client">;
/** An island request from the browser: the server sets the client context. */
export type ProxiedIslandRequest = Omit<IslandRequest, "client">;
/** An action request from the browser: the server sets the client context. */
export type ProxiedActionRequest = Omit<ActionRequest, "client">;

/** The composer's response, or the status and body it failed with. */
export type ProxyResult<T> =
  { ok: true; response: T } | { ok: false; status: number; body: string };

export interface ComposerProxyOptions {
  /** Composer base URL. */
  baseUrl: string;
  /** The client context for each request, e.g. with the locale from the request's cookies. */
  client: () => ClientContext | Promise<ClientContext>;
  /** Extra headers for each request, e.g. `Authorization` from a session cookie. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Extra options for every request, e.g. `{ cache: "no-store" }`. */
  requestInit?: RequestInit & Record<string, unknown>;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Sees each action's response (ok or a declared error) before the browser does, and returns
   * what the browser gets: e.g. keep a new session in a cookie, and take its token out.
   */
  onActionResponse?: (
    request: ActionRequest,
    response: ActionResponse,
  ) => ActionResponse | Promise<ActionResponse>;
}

export interface ComposerProxy {
  /** Checks a browser's action request, then performs it with the server's context and headers. */
  performAction(body: unknown): Promise<ProxyResult<ActionResponse>>;
  /** Checks a browser's screen request, then loads it with the server's context and headers. */
  loadScreen(body: unknown): Promise<ProxyResult<ScreenResponse>>;
  /**
   * Checks a browser's island request (a page of an island, spec §4.5), then loads it with the
   * server's context and headers. Resolves with the island's entry.
   */
  loadIsland(body: unknown): Promise<ProxyResult<IslandEntry>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isCapabilities(value: unknown): value is Capabilities {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (versions) => Array.isArray(versions) && versions.every((v) => typeof v === "number"),
    )
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
}

export function isProxiedScreenRequest(value: unknown): value is ProxiedScreenRequest {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL_VERSION &&
    typeof value.screen === "string" &&
    (value.params === undefined || isStringRecord(value.params)) &&
    isCapabilities(value.islands)
  );
}

export function isProxiedIslandRequest(value: unknown): value is ProxiedIslandRequest {
  if (!isRecord(value) || value.protocol !== PROTOCOL_VERSION) {
    return false;
  }
  const addressed = typeof value.screen === "string" && typeof value.key === "string";
  const versioned = typeof value.version === "number" && Number.isInteger(value.version);
  const paramsOk = value.params === undefined || isStringRecord(value.params);
  const cursorOk = value.cursor === undefined || typeof value.cursor === "string";
  return addressed && versioned && paramsOk && cursorOk;
}

export function isProxiedActionRequest(value: unknown): value is ProxiedActionRequest {
  return (
    isRecord(value) &&
    value.protocol === PROTOCOL_VERSION &&
    typeof value.action === "string" &&
    typeof value.version === "number" &&
    "input" in value &&
    (value.idempotencyKey === undefined || typeof value.idempotencyKey === "string")
  );
}

/** What the composer itself answers to a malformed request. */
const BAD_REQUEST = {
  ok: false,
  status: 400,
  body: JSON.stringify({ protocol: PROTOCOL_VERSION, error: { code: "bad_request" } }),
} as const;

export function createComposerProxy(options: ComposerProxyOptions): ComposerProxy {
  async function init(): Promise<RequestInit> {
    const headers = new Headers(options.requestInit?.headers);
    for (const [name, value] of Object.entries((await options.headers?.()) ?? {})) {
      headers.set(name, value);
    }
    return { ...options.requestInit, headers };
  }

  async function performAction(body: unknown): Promise<ProxyResult<ActionResponse>> {
    if (!isProxiedActionRequest(body)) {
      return BAD_REQUEST;
    }
    const request: ActionRequest = { ...body, client: await options.client() };
    try {
      const response = await fetchAction(options.baseUrl, request, await init(), options.fetch);
      return {
        ok: true,
        response: (await options.onActionResponse?.(request, response)) ?? response,
      };
    } catch (error) {
      if (error instanceof ActionFetchError) {
        return {
          ok: false,
          status: error.status,
          body: error.body,
        };
      }
      throw error;
    }
  }

  async function loadScreen(body: unknown): Promise<ProxyResult<ScreenResponse>> {
    if (!isProxiedScreenRequest(body)) {
      return BAD_REQUEST;
    }
    const request: ScreenRequest = { ...body, client: await options.client() };
    try {
      return {
        ok: true,
        response: await fetchScreen(options.baseUrl, request, await init(), options.fetch),
      };
    } catch (error) {
      if (error instanceof ScreenFetchError) {
        return {
          ok: false,
          status: error.status,
          body: error.body,
        };
      }
      throw error;
    }
  }

  async function loadIsland(body: unknown): Promise<ProxyResult<IslandEntry>> {
    if (!isProxiedIslandRequest(body)) {
      return BAD_REQUEST;
    }
    const request: IslandRequest = { ...body, client: await options.client() };
    try {
      return {
        ok: true,
        response: await fetchIsland(options.baseUrl, request, await init(), options.fetch),
      };
    } catch (error) {
      if (error instanceof IslandFetchError) {
        return {
          ok: false,
          status: error.status,
          body: error.body,
        };
      }
      throw error;
    }
  }

  return {
    performAction,
    loadScreen,
    loadIsland,
  };
}
