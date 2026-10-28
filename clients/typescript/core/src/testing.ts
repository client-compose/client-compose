// Test helpers for apps built on Client Compose: a fake composer that answers screen and action
// requests from handlers and records them, and builders for the responses it returns. No test
// framework of its own, so it works with node:test, Jest, Vitest, Playwright and others.
//
//     const gateway = createFakeGateway({
//       screens: { profile: () => screen("profile", [island("header", ProfileHeaderV1, { name: "Ada" })]) },
//       actions: { follow: () => actionOk(FollowUserV1, { followers: 8 }) },
//       islands: { "profile/posts": (r) => islandResponse("profile", island("posts", PostsV1, …, "page:3")) },
//       strings: () => stringsResponse("en", { retry: "Try again" }),
//     });
//     // pass gateway.fetch as the client's fetch, then assert on gateway.actionRequests()
//
// For code that uses the global fetch itself, `installFakeGateway` puts one in its place.

import {
  type ActionDescriptor,
  type ActionEffects,
  type AppStringsDescriptor,
  buildStrings,
  type Capabilities,
  type ClientContext,
  type DeclaredError,
  type IslandDescriptor,
  type IslandEntry,
  type IslandError,
  type PendingIsland,
  type PluralRules,
  PROTOCOL_VERSION,
  type ScreenMeta,
  type Strings,
  type StringsResponse,
} from "@client-compose/protocol";

/**
 * A response for the fake composer to send: a JSON body, or a screen's stream (spec §4.6), as
 * lines that come when they're given.
 */
export interface FakeResponse {
  status: number;
  body?: unknown;
  /** Opens the stream's body, for each request answered with it. */
  stream?: () => ReadableStream<Uint8Array>;
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

/** A strings request (spec §4.7): the app strings, in the client's language. */
export interface RecordedStringsRequest extends RecordedRequest {
  client: ClientContext | undefined;
}

export interface FakeGatewayHandlers {
  /** By screen id. */
  screens?: Record<string, (request: RecordedScreenRequest) => FakeResponse>;
  /** By action name. */
  actions?: Record<string, (request: RecordedActionRequest) => FakeResponse>;
  /** Island requests, by `"{screen}/{key}"`. */
  islands?: Record<string, (request: RecordedIslandRequest) => FakeResponse>;
  /** The app strings (POST /strings). */
  strings?: (request: RecordedStringsRequest) => FakeResponse;
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
  stringsRequests(): RecordedStringsRequest[];
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

function asStringsRequest(request: RecordedRequest): RecordedStringsRequest | undefined {
  const path = request.url.split("?")[0] ?? "";
  if (!/\/strings\/?$/.test(path) || !isRecord(request.body)) {
    return undefined;
  }
  return { ...request, client: clientContext(request.body.client) };
}

function respond(response: FakeResponse): Response {
  if (response.stream) {
    return new Response(response.stream(), {
      status: response.status,
      headers: { "content-type": "application/jsonl" },
    });
  }
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
    const stringsRequest = asStringsRequest(request);
    if (stringsRequest && handlers.strings) {
      return respond(handlers.strings(stringsRequest));
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
    stringsRequests: () => requests.flatMap((r) => asStringsRequest(r) ?? []),
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

/** More of an island's entry: its next page's cursor (spec §4.5), and its strings (spec §4.7). */
export interface IslandOptions {
  next?: string;
  strings?: Strings;
}

/**
 * An island in a screen or island response, typed by its generated descriptor. Give `next` for an
 * island with more pages (spec §4.5), or `{ next, strings }`.
 */
export function island<P, S>(
  key: string,
  descriptor: IslandDescriptor<P, S>,
  props: P,
  more?: string | IslandOptions,
): IslandEntry<P> {
  const { next, strings } =
    typeof more === "string" ? { next: more, strings: undefined } : (more ?? {});
  return {
    key,
    type: descriptor.type,
    version: descriptor.version,
    status: "ok",
    props,
    ...(next !== undefined && { next }),
    ...(strings !== undefined && { strings }),
  };
}

/** The language a screen is in, and its plural rules (spec §4.7). */
export interface ScreenLanguage {
  locale: string;
  plurals: PluralRules;
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

/** A screen, all of it at once: its stream's head with every island, then its end (spec §4.6). */
export function screen(
  id: string,
  islands: IslandEntry<unknown>[],
  meta?: ScreenMeta,
  language?: ScreenLanguage,
): FakeResponse {
  const head = {
    kind: "head",
    protocol: PROTOCOL_VERSION,
    screen: id,
    islands,
    ...(meta && { meta }),
    ...language,
  };
  return {
    status: 200,
    stream: () => linesStream([head, { kind: "end" }]),
  };
}

/** An island still being resolved, in a streamed screen's head (spec §4.6). */
export function pending(key: string, descriptor: IslandDescriptor<unknown>): PendingIsland {
  return {
    key,
    type: descriptor.type,
    version: descriptor.version,
    status: "pending",
  };
}

/** A streamed screen whose lines a test sends, so it controls when each island arrives. */
export interface StreamedScreen extends FakeResponse {
  /** Sends a pending island's entry. */
  send(entry: IslandEntry<unknown>): void;
  /** Sends the end line. */
  end(): void;
  /** Ends the stream without its end line, as a dropped connection would. */
  cut(): void;
}

/**
 * A screen whose head is sent at once, with its islands resolved or `pending(…)`, and whose other
 * lines are sent when the test says (spec §4.6). Answer one request with it.
 *
 *     const results = streamedScreen("search", [island("box", BoxV1, {}), pending("results", ResultsV1)]);
 *     // render, check the placeholder, then:
 *     results.send(island("results", ResultsV1, { items: [] }));
 *     results.end();
 */
export function streamedScreen(
  id: string,
  islands: (IslandEntry<unknown> | PendingIsland)[],
  meta?: ScreenMeta,
  language?: ScreenLanguage,
): StreamedScreen {
  const encoder = new TextEncoder();
  const queued: string[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  const write = (line: unknown) => {
    const text = `${JSON.stringify(line)}\n`;
    if (controller) {
      controller.enqueue(encoder.encode(text));
    } else {
      queued.push(text);
    }
  };
  const close = () => {
    closed = true;
    controller?.close();
  };
  write({
    kind: "head",
    protocol: PROTOCOL_VERSION,
    screen: id,
    islands,
    ...(meta && { meta }),
    ...language,
  });
  return {
    status: 200,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          for (const text of queued.splice(0)) {
            c.enqueue(encoder.encode(text));
          }
          if (closed) {
            c.close();
          }
        },
      }),
    send: (entry) => write({ kind: "island", island: entry }),
    end: () => {
      write({ kind: "end" });
      close();
    },
    cut: close,
  };
}

function linesStream(lines: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    },
  });
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

/** The app strings in a language (spec §4.7), with its plural rules if its counted strings need them. */
export function stringsResponse(
  locale: string,
  strings: Strings,
  plurals: PluralRules = {},
): FakeResponse {
  return {
    status: 200,
    body: {
      protocol: PROTOCOL_VERSION,
      locale,
      plurals,
      strings,
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

// ---- A catalog's words ----

/**
 * A language's strings as a composer keeps them (codegen's `catalog`, e.g. `catalog/en.json`): the
 * app strings, and each island's by `"{type}@{version}"`. Anything else in it is ignored here.
 */
export interface Catalog {
  app?: Strings;
  islands?: Record<string, Strings>;
}

/** A catalog's words, as a client gets them from the composer: for tests that read real copy. */
export interface CatalogStrings {
  /** An island's strings, as its component gets them: `<RecipeList t={english.t(RecipeListV1)} …>`. */
  t<P, S>(descriptor: IslandDescriptor<P, S>): S;
  /** The app strings, typed by their generated descriptor: `english.app(AppStrings).retry`. */
  app<S>(descriptor: AppStringsDescriptor<S>): S;
  /** The app strings as the composer answers `/strings`, e.g. for `<AppStringsProvider initial>`. */
  appStrings: StringsResponse;
  /** The fake composer's `strings` answer. */
  stringsResponse(): FakeResponse;
  /** An island in a screen or island response, with its strings, as the composer sends it. */
  island<P, S>(
    key: string,
    descriptor: IslandDescriptor<P, S>,
    props: P,
    next?: string,
  ): IslandEntry<P>;
}

/** English's plural rules: one for 1, other for everything else. */
const english: ScreenLanguage = { locale: "en", plurals: { one: "i = 1 and v = 0" } };

/**
 * A catalog's words, for tests: islands' `t`, the app strings, and islands that carry their strings,
 * as the composer would send them. Its language is English unless you say (with its plural rules).
 *
 *     import catalog from "../catalog/en.json" with { type: "json" };
 *     const english = catalogStrings(catalog);
 *     render(<RecipeList t={english.t(RecipeListV1)} {...props} />);
 */
export function catalogStrings(
  catalog: Catalog,
  language: ScreenLanguage = english,
): CatalogStrings {
  const islandStrings = (descriptor: IslandDescriptor<unknown, unknown>) =>
    catalog.islands?.[`${descriptor.type}@${descriptor.version}`];
  const appStrings: StringsResponse = {
    protocol: PROTOCOL_VERSION,
    locale: language.locale,
    plurals: language.plurals,
    strings: catalog.app ?? {},
  };
  return {
    t: (descriptor) =>
      buildStrings(descriptor.strings ?? {}, islandStrings(descriptor), language.plurals),
    app: (descriptor) => buildStrings(descriptor.strings, appStrings.strings, language.plurals),
    appStrings,
    stringsResponse: () => stringsResponse(language.locale, appStrings.strings, language.plurals),
    island: (key, descriptor, props, next) =>
      island(key, descriptor, props, { next, strings: islandStrings(descriptor) }),
  };
}
