// Test helpers for apps built on Client Compose: a fake composer that answers screen and action
// requests from handlers and records them, and builders for the responses it returns. No test
// framework of its own, so it works with node:test, Jest, Vitest, Playwright and others.
//
//     const gateway = createFakeGateway({
//       screens: { profile: () => screen("profile", [island("header", ProfileHeaderV1, { name: "Ada" })]) },
//       actions: { follow: () => actionOk(FollowUserV1, { followers: 8 }) },
//       islands: { "profile/posts": (r) => islandResponse("profile", island("posts", PostsV1, …, "page:3")) },
//     });
//     // pass gateway.fetch as the client's fetch, then assert on gateway.actionRequests()
//
// For code that uses the global fetch itself, `installFakeGateway` puts one in its place.

import {
  type ActionDescriptor,
  type ActionEffects,
  type Capabilities,
  type ClientContext,
  type DeclaredError,
  type IslandDescriptor,
  type IslandEntry,
  type IslandError,
  PROTOCOL_VERSION,
  type ScreenMeta,
} from "@client-compose/protocol";

/** A response for the fake composer to send. */
export interface FakeResponse {
  status: number;
  body: unknown;
}

/** A request the fake composer received. */
export interface RecordedRequest {
  url: string;
  method: string;
  /** Header names are lower case. */
  headers: Record<string, string>;
  /** The JSON body, parsed; or the raw body when it isn't JSON (e.g. a multipart upload). */
  body: unknown;
}

export interface RecordedScreenRequest extends RecordedRequest {
  screen: string;
  params: Record<string, string>;
  client: ClientContext | undefined;
  islands: Capabilities;
}

/** An island request (spec §4.5): a page of one island, or the island resolved again. */
export interface RecordedIslandRequest extends RecordedRequest {
  screen: string;
  key: string;
  version: number;
  params: Record<string, string>;
  cursor: string | undefined;
  client: ClientContext | undefined;
}

export interface RecordedActionRequest extends RecordedRequest {
  action: string;
  version: number;
  input: unknown;
  client: ClientContext | undefined;
  idempotencyKey: string | undefined;
}

export interface FakeGatewayHandlers {
  /** By screen id. */
  screens?: Record<string, (request: RecordedScreenRequest) => FakeResponse>;
  /** By action name. */
  actions?: Record<string, (request: RecordedActionRequest) => FakeResponse>;
  /** Island requests, by `"{screen}/{key}"`. */
  islands?: Record<string, (request: RecordedIslandRequest) => FakeResponse>;
  /** Anything else, e.g. uploads to storage: return undefined to leave a request to the others. */
  other?: (request: RecordedRequest) => FakeResponse | undefined;
}

export interface FakeGateway {
  /** Use as the client's `fetch`. Requests without a handler reject, failing the test. */
  fetch: typeof fetch;
  /** Every request received, in order. */
  requests: RecordedRequest[];
  screenRequests(): RecordedScreenRequest[];
  islandRequests(): RecordedIslandRequest[];
  actionRequests(): RecordedActionRequest[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function strings(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

function capabilities(value: unknown): Capabilities {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([type, versions]) => [
      type,
      Array.isArray(versions) ? versions.filter((v): v is number => typeof v === "number") : [],
    ]),
  );
}

function clientContext(value: unknown): ClientContext | undefined {
  if (
    !isRecord(value) ||
    typeof value.platform !== "string" ||
    typeof value.appVersion !== "string"
  ) {
    return undefined;
  }
  return {
    ...value,
    platform: value.platform,
    appVersion: value.appVersion,
  } as ClientContext;
}

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return body;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function headersOf(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, name) => (out[name] = value));
  return out;
}

function isIslandURL(url: string): boolean {
  return /\/screens\/[^/]+\/islands\/[^/?]+/.test(url);
}

function asScreenRequest(request: RecordedRequest): RecordedScreenRequest | undefined {
  const { body } = request;
  const isScreen = request.url.includes("/screens/") && !isIslandURL(request.url);
  if (!isScreen || !isRecord(body) || typeof body.screen !== "string") {
    return undefined;
  }
  return {
    ...request,
    screen: body.screen,
    params: strings(body.params),
    client: clientContext(body.client),
    islands: capabilities(body.islands),
  };
}

function asIslandRequest(request: RecordedRequest): RecordedIslandRequest | undefined {
  const { body } = request;
  if (!isIslandURL(request.url) || !isRecord(body)) {
    return undefined;
  }
  if (typeof body.screen !== "string" || typeof body.key !== "string") {
    return undefined;
  }
  return {
    ...request,
    screen: body.screen,
    key: body.key,
    version: typeof body.version === "number" ? body.version : 0,
    params: strings(body.params),
    cursor: typeof body.cursor === "string" ? body.cursor : undefined,
    client: clientContext(body.client),
  };
}

function asActionRequest(request: RecordedRequest): RecordedActionRequest | undefined {
  const { body } = request;
  if (!request.url.includes("/actions/") || !isRecord(body) || typeof body.action !== "string") {
    return undefined;
  }
  return {
    ...request,
    action: body.action,
    version: typeof body.version === "number" ? body.version : 0,
    input: body.input,
    client: clientContext(body.client),
    idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined,
  };
}

function respond(response: FakeResponse): Response {
  return new Response(JSON.stringify(response.body), {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

/** A composer whose screens and actions are the handlers given. */
export function createFakeGateway(handlers: FakeGatewayHandlers = {}): FakeGateway {
  const requests: RecordedRequest[] = [];
  async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request: RecordedRequest = {
      url: urlOf(input),
      method: init?.method ?? "GET",
      headers: headersOf(init?.headers),
      body: parseBody(init?.body),
    };
    requests.push(request);

    const other = handlers.other?.(request);
    if (other) {
      return respond(other);
    }
    const islandRequest = asIslandRequest(request);
    const islandHandler =
      islandRequest && handlers.islands?.[`${islandRequest.screen}/${islandRequest.key}`];
    if (islandRequest && islandHandler) {
      return respond(islandHandler(islandRequest));
    }
    const screenRequest = asScreenRequest(request);
    const screenHandler = screenRequest && handlers.screens?.[screenRequest.screen];
    if (screenRequest && screenHandler) {
      return respond(screenHandler(screenRequest));
    }
    const actionRequest = asActionRequest(request);
    const actionHandler = actionRequest && handlers.actions?.[actionRequest.action];
    if (actionRequest && actionHandler) {
      return respond(actionHandler(actionRequest));
    }
    throw new Error(
      `fake gateway: no handler for ${request.method} ${request.url} ${JSON.stringify(request.body)}`,
    );
  }
  return {
    fetch: fakeFetch,
    requests,
    screenRequests: () => requests.flatMap((r) => asScreenRequest(r) ?? []),
    islandRequests: () => requests.flatMap((r) => asIslandRequest(r) ?? []),
    actionRequests: () => requests.flatMap((r) => asActionRequest(r) ?? []),
  };
}

export interface InstalledFakeGateway extends FakeGateway {
  /** Puts back the `fetch` that was there before. */
  restore(): void;
}

/**
 * A fake composer installed as the global `fetch`, for code that fetches by itself (e.g. a whole
 * app rendered in a test). Call `restore()` after the test.
 */
export function installFakeGateway(handlers: FakeGatewayHandlers = {}): InstalledFakeGateway {
  const gateway = createFakeGateway(handlers);
  const original = globalThis.fetch;
  globalThis.fetch = gateway.fetch;
  return {
    ...gateway,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ---- Responses ----

/**
 * An island in a screen or island response, typed by its generated descriptor. Give `next` for an
 * island with more pages (spec §4.5).
 */
export function island<P>(
  key: string,
  descriptor: IslandDescriptor<P>,
  props: P,
  next?: string,
): IslandEntry<P> {
  return {
    key,
    type: descriptor.type,
    version: descriptor.version,
    status: "ok",
    props,
    ...(next !== undefined && { next }),
  };
}

/** An island that failed on the composer (spec §3.4). */
export function islandError(
  key: string,
  descriptor: IslandDescriptor<unknown>,
  error: IslandError,
): IslandEntry {
  return {
    key,
    type: descriptor.type,
    version: descriptor.version,
    status: "error",
    error,
  };
}

/** A screen response. */
export function screen(
  id: string,
  islands: IslandEntry<unknown>[],
  meta?: ScreenMeta,
): FakeResponse {
  return {
    status: 200,
    body: {
      protocol: PROTOCOL_VERSION,
      screen: id,
      islands,
      ...(meta && { meta }),
    },
  };
}

/** An island response (spec §4.5): a page of one island, or the island resolved again. */
export function islandResponse(screen: string, entry: IslandEntry<unknown>): FakeResponse {
  return {
    status: 200,
    body: {
      protocol: PROTOCOL_VERSION,
      screen,
      island: entry,
    },
  };
}

/** A screen request that fails, e.g. `screenError(404, "not_found")` or `screenError(401, "unauthenticated")`. */
export function screenError(status: number, code: string): FakeResponse {
  return { status, body: { protocol: PROTOCOL_VERSION, error: { code } } };
}

/** An action that succeeded, with its result typed by the descriptor. */
export function actionOk<I, R, E extends DeclaredError>(
  action: ActionDescriptor<I, R, E>,
  result: R,
  effects?: ActionEffects,
): FakeResponse {
  const base = {
    protocol: PROTOCOL_VERSION,
    action: action.action,
    version: action.version,
  };
  return {
    status: 200,
    body: {
      ...base,
      status: "ok",
      result,
      ...(effects && { effects }),
    },
  };
}

/** An action that ended with one of its declared errors. */
export function actionError<I, R, E extends DeclaredError>(
  action: ActionDescriptor<I, R, E>,
  error: E,
): FakeResponse {
  const base = {
    protocol: PROTOCOL_VERSION,
    action: action.action,
    version: action.version,
  };
  return {
    status: 200,
    body: {
      ...base,
      status: "error",
      error,
    },
  };
}

/** An action the composer didn't perform, e.g. `actionFailure(401, "unauthenticated")` (spec §5.4). */
export function actionFailure(status: number, code: string): FakeResponse {
  return { status, body: { protocol: PROTOCOL_VERSION, error: { code } } };
}
