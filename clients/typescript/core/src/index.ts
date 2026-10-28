// Framework-agnostic client core for JS/TS frontends (web, React Native, etc).
// `R` is whatever your UI layer renders: a React element, a DOM node, a string...

import {
  type ActionDescriptor,
  type ActionRequest,
  type ActionResponse,
  type Capabilities,
  type ClientContext,
  type DeclaredError,
  type IslandDescriptor,
  type IslandEntry,
  type IslandRequest,
  type IslandResponse,
  type PluralRules,
  PROTOCOL_VERSION,
  type ScreenHead,
  type ScreenRequest,
  type ScreenResponse,
  type StringParams,
} from "@client-compose/protocol";

import { buildStrings } from "./strings.ts";

export { preferredLocale } from "./locale.ts";
export {
  appStrings,
  buildStrings,
  fetchStrings,
  formatString,
  pluralCategory,
  StringsFetchError,
  type StringValues,
} from "./strings.ts";

type OkEntry<P = unknown> = IslandEntry<P> & { status: "ok" };
type ErrorEntry = IslandEntry & { status: "error" };

/**
 * An island's props as its renderer gets them: with its strings as `t` (spec §4.7), if its
 * descriptor declares any.
 */
export type WithStrings<P, S> = P & (unknown extends S ? unknown : { t: S });

/**
 * The props an island's component gets, from its generated descriptor: its props, and its strings
 * as `t` if it declares any. `function ProfileHeader(props: IslandProps<typeof ProfileHeaderV1>)`.
 */
export type IslandProps<D> =
  D extends IslandDescriptor<infer P, infer S> ? WithStrings<P, S> : never;

/**
 * Renders an island: its props (with `t`, if it declares strings), its entry as the composer sent
 * it, and the screen's plural rules (spec §4.7).
 */
export type IslandRenderer<R, P = unknown> = (props: P, entry: OkEntry, plurals?: PluralRules) => R;

/** What a client shows for an island still pending in a stream's head (spec §4.6). */
export type IslandPlaceholder<R> = () => R;

export class IslandRegistry<R> {
  private renderers = new Map<string, Map<number, IslandRenderer<R>>>();
  private placeholders = new Map<string, IslandPlaceholder<R>>();
  private declaredStrings = new Map<string, StringParams>();
  // Each entry's props with its `t`, made once: a screen streaming in plans again with each island
  // that arrives, and the islands already shown keep the props they were rendered with.
  private propsMade = new WeakMap<object, { plurals?: PluralRules; props: unknown }>();

  /**
   * Register a placeholder for an island version, shown while it's pending in a stream's head
   * (spec §4.6). Each app draws its own: the protocol says nothing about how one looks.
   */
  registerPlaceholder(island: IslandDescriptor<unknown>, placeholder: IslandPlaceholder<R>): this {
    this.placeholders.set(`${island.type}@${island.version}`, placeholder);
    return this;
  }

  /** The placeholder for an island version, if one was registered. */
  placeholder(type: string, version: number): IslandPlaceholder<R> | undefined {
    return this.placeholders.get(`${type}@${version}`);
  }

  /**
   * Register a renderer for a generated island descriptor: `register(ProfileHeaderV2, (props) => …)`.
   * If the island declares strings, its props have them as `t`: `props.t.heading`.
   */
  register<P, S>(
    island: IslandDescriptor<P, S>,
    render: IslandRenderer<R, WithStrings<P, S>>,
  ): this;
  register<P>(type: string, version: number, render: IslandRenderer<R, P>): this;
  register<P, S>(
    islandOrType: IslandDescriptor<P, S> | string,
    versionOrRender: number | IslandRenderer<R, WithStrings<P, S>>,
    maybeRender?: IslandRenderer<R, P>,
  ): this {
    if (typeof islandOrType !== "string") {
      if (typeof versionOrRender === "number") {
        throw new Error("register(descriptor, render): pass the renderer, not a version");
      }
      const id = `${islandOrType.type}@${islandOrType.version}`;
      if (islandOrType.strings) {
        this.declaredStrings.set(id, islandOrType.strings);
      } else {
        this.declaredStrings.delete(id);
      }
      return this.add(islandOrType.type, islandOrType.version, versionOrRender);
    }
    if (typeof versionOrRender !== "number" || !maybeRender) {
      throw new Error("register(type, version, render): pass a version and a renderer");
    }
    return this.add(islandOrType, versionOrRender, maybeRender);
  }

  private add<P>(type: string, version: number, render: IslandRenderer<R, P>): this {
    const versions = this.renderers.get(type) ?? new Map<number, IslandRenderer<R>>();
    // The registry hands each renderer the props of its own island type and version, so the
    // renderer's props type holds. TypeScript can't see that through one map of every island.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    versions.set(version, render as IslandRenderer<R>);
    this.renderers.set(type, versions);
    return this;
  }

  capabilities(): Capabilities {
    return Object.fromEntries(
      [...this.renderers].map(([type, versions]) => [
        type,
        [...versions.keys()].sort((a, b) => a - b),
      ]),
    );
  }

  get(type: string, version: number): IslandRenderer<R> | undefined {
    return this.renderers.get(type)?.get(version);
  }

  /**
   * An island's props as its renderer gets them: with its strings as `t`, built with the screen's
   * plural rules, if its descriptor declares any.
   */
  propsOf(entry: OkEntry, plurals: PluralRules | undefined): unknown {
    const declared = this.declaredStrings.get(`${entry.type}@${entry.version}`);
    if (!declared) {
      return entry.props;
    }
    const made = this.propsMade.get(entry);
    if (made && made.plurals === plurals) {
      return made.props;
    }
    const props = {
      ...(typeof entry.props === "object" ? entry.props : {}),
      t: buildStrings(declared, entry.strings, plurals),
    };
    this.propsMade.set(entry, { plurals, props });
    return props;
  }
}

export function buildRequest(
  registry: IslandRegistry<unknown>,
  screen: string,
  client: ClientContext,
  params?: Record<string, string>,
): ScreenRequest {
  return {
    protocol: PROTOCOL_VERSION,
    screen,
    params,
    client,
    islands: registry.capabilities(),
  };
}

export interface PlannedIsland<R> {
  key: string;
  render: () => R;
  /** It's a placeholder, for an island still pending in a stream's head (spec §4.6). */
  pending?: boolean;
}

export type SkipReason = "unknown_island" | "unknown_status";

export interface PlanOptions<R> {
  /** Render something for errored islands. Default: omit them (spec §4.3). */
  onError?: (entry: ErrorEntry) => R | undefined;
  /** Called for islands the client can't render (spec §4.4). Useful for telemetry. */
  onSkipped?: (entry: IslandEntry, reason: SkipReason) => void;
}

/**
 * Turn a screen, or a stream's head (spec §4.6), into an ordered list of renderable islands. An
 * island still pending is its registered placeholder, or left out until it arrives.
 */
export function plan<R>(
  registry: IslandRegistry<R>,
  response: ScreenResponse | ScreenHead,
  options: PlanOptions<R> = {},
): PlannedIsland<R>[] {
  const out: PlannedIsland<R>[] = [];
  for (const entry of response.islands) {
    if (entry.status === "pending") {
      const placeholder = registry.get(entry.type, entry.version)
        ? registry.placeholder(entry.type, entry.version)
        : undefined;
      if (placeholder) {
        out.push({
          key: entry.key,
          render: placeholder,
          pending: true,
        });
      }
      continue;
    }
    if (entry.status === "error") {
      const fallback = options.onError?.(entry);
      if (fallback !== undefined) {
        out.push({ key: entry.key, render: () => fallback });
      }
      continue;
    }
    if (entry.status !== "ok") {
      options.onSkipped?.(entry, "unknown_status");
      continue;
    }
    const renderer = registry.get(entry.type, entry.version);
    if (!renderer) {
      options.onSkipped?.(entry, "unknown_island");
      continue;
    }
    const props = registry.propsOf(entry, response.plurals);
    out.push({ key: entry.key, render: () => renderer(props, entry, response.plurals) });
  }
  return out;
}

// ---- Reading what the composer answered ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body as JSON, or undefined if it isn't JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isIslandEntry(value: unknown): value is IslandEntry {
  if (!isRecord(value)) {
    return false;
  }
  const named = typeof value.key === "string" && typeof value.type === "string";
  return named && typeof value.version === "number" && typeof value.status === "string";
}

/** An action's outcome: what a client needs of one is its status (the client fixtures, spec §8.2). */
function isActionResponse(value: unknown): value is ActionResponse {
  return isRecord(value) && (value.status === "ok" || value.status === "error");
}

export class ScreenFetchError extends Error {
  readonly status: number;
  readonly body: string;
  /** The protocol error code from the response body (e.g. "not_found"), if there was one. */
  readonly code: string | undefined;

  constructor(status: number, body: string) {
    super(`Screen request failed with status ${status}`);
    this.status = status;
    this.body = body;
    this.code = errorCode(body);
  }
}

function errorCode(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    const error = isRecord(parsed) ? parsed.error : undefined;
    const code = isRecord(error) ? error.code : undefined;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The caller's headers, given any way fetch takes them, sent as JSON unless they say otherwise.
 * (Spreading a `Headers` object would drop them all.)
 */
function jsonHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers(init);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

/**
 * Fetch a screen, all of it: its stream (spec §4.6) read to the end. Throws ScreenFetchError for a
 * non-2xx response (e.g. `not_found`) or one that isn't a screen. To show its islands as they
 * arrive, use openScreen.
 */
export async function fetchScreen(
  baseUrl: string,
  request: ScreenRequest,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ScreenResponse> {
  return collectScreen(await openScreen(baseUrl, request, init, fetchImpl));
}

// ---- Streams (spec §4.6) ----

/** A screen as it arrives: its head, then each pending island as the composer resolves it. */
export interface ScreenStream {
  /** The screen, its islands resolved or pending. */
  head: ScreenHead;
  /**
   * Each pending island's entry, as it arrives. If the stream ends early, those that never came
   * arrive as errors: `incomplete`, retryable.
   */
  islands: AsyncIterable<IslandEntry>;
}

/**
 * Request a screen, and resolve once its head has arrived. Throws ScreenFetchError for a non-2xx
 * response (e.g. `not_found`) or one that isn't a screen's stream.
 */
export async function openScreen(
  baseUrl: string,
  request: ScreenRequest,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ScreenStream> {
  const res = await fetchImpl(`${baseUrl}/screens/${encodeURIComponent(request.screen)}`, {
    ...init,
    method: "POST",
    headers: jsonHeaders(init.headers),
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new ScreenFetchError(res.status, await res.text());
  }
  const lines = linesOf(res)[Symbol.asyncIterator]();
  const first = await lines.next();
  const head = first.done ? undefined : parseJson(first.value);
  if (!isRecord(head) || head.kind !== "head" || !isScreenHead(head)) {
    await lines.return?.();
    throw new ScreenFetchError(res.status, first.done ? "" : first.value);
  }
  const { kind: _kind, ...screen } = head;
  return { head: screen, islands: pendingIslands(screen, lines) };
}

/** Reads the rest of a stream, and returns the screen with every island in place. */
export async function collectScreen(stream: ScreenStream): Promise<ScreenResponse> {
  let head = stream.head;
  for await (const entry of stream.islands) {
    head = withIsland(head, entry);
  }
  return {
    ...head,
    islands: head.islands.filter((e): e is IslandEntry => e.status !== "pending"),
  };
}

/** The head with a pending island's entry in its place; unchanged if the key isn't pending. */
export function withIsland(head: ScreenHead, entry: IslandEntry): ScreenHead {
  return {
    ...head,
    islands: head.islands.map((e) => (e.key === entry.key && e.status === "pending" ? entry : e)),
  };
}

/** A screen's head and end as a stream, for a screen that's already complete (spec §4.6). */
export function screenLines(screen: ScreenResponse): string {
  return `${JSON.stringify({ kind: "head", ...screen })}\n${JSON.stringify({ kind: "end" })}\n`;
}

function isScreenHead(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ScreenHead {
  return (
    typeof value.screen === "string" &&
    Array.isArray(value.islands) &&
    value.islands.every(isIslandEntry)
  );
}

/** The islands pending in `head`, as `lines` bring them, until the end line. */
async function* pendingIslands(
  head: ScreenHead,
  lines: AsyncIterator<string>,
): AsyncIterable<IslandEntry> {
  const waiting = new Map(
    head.islands.filter((e) => e.status === "pending").map((e) => [e.key, e]),
  );
  try {
    while (waiting.size > 0) {
      const next = await lines.next();
      if (next.done) {
        break;
      }
      const line = parseJson(next.value);
      if (!isRecord(line) || line.kind === "end") {
        break;
      }
      // Lines of a kind it doesn't know, or for an island that isn't pending, are skipped (spec §4.6).
      const entry = line.kind === "island" && isRecord(line.island) ? line.island : undefined;
      if (entry?.status !== "pending" && isIslandEntry(entry) && waiting.delete(entry.key)) {
        yield entry;
      }
    }
  } finally {
    await lines.return?.();
  }
  for (const e of waiting.values()) {
    yield {
      key: e.key,
      type: e.type,
      version: e.version,
      status: "error",
      error: { code: "incomplete", retryable: true },
    };
  }
}

/** A body's lines, as they arrive if the body can be read as a stream, or all at once. */
async function* linesOf(res: Response): AsyncIterable<string> {
  if (!res.body) {
    yield* (await res.text()).split("\n").filter((line) => line !== "");
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      yield* lines.filter((line) => line !== "");
    }
    buffered += decoder.decode();
    if (buffered.trim() !== "") {
      yield buffered;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// ---- Island requests (spec §4.5) ----

/**
 * A request for one island of a screen: the page `cursor` asks for (an entry's `next`), or the
 * island from its first page without one. `params` are the screen's own.
 */
export function buildIslandRequest(
  screen: string,
  params: Record<string, string> | undefined,
  entry: { key: string; version: number },
  client: ClientContext,
  cursor?: string,
): IslandRequest {
  return {
    protocol: PROTOCOL_VERSION,
    screen,
    key: entry.key,
    version: entry.version,
    params,
    client,
    ...(cursor !== undefined && { cursor }),
  };
}

/**
 * POST an island request. Resolves with the island's entry: its props (and `next`, if it has more
 * pages) or the error it failed with. Throws IslandFetchError for a non-2xx response (e.g.
 * `invalid_cursor`, `unknown_island`, `unauthenticated`), or an answer that isn't this island.
 */
export async function fetchIsland(
  baseUrl: string,
  request: IslandRequest,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<IslandEntry> {
  const path = `${encodeURIComponent(request.screen)}/islands/${encodeURIComponent(request.key)}`;
  const res = await fetchImpl(`${baseUrl}/screens/${path}`, {
    ...init,
    method: "POST",
    headers: jsonHeaders(init.headers),
    body: JSON.stringify(request),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new IslandFetchError(res.status, text);
  }
  const response = parseJson(text);
  if (!isIslandResponse(response) || !isIslandAsked(response.island, request)) {
    throw new IslandFetchError(res.status, text);
  }
  return response.island;
}

/**
 * An island request failed: a non-2xx response such as `invalid_cursor`, `unknown_island` or
 * `unauthenticated`, or an answer that isn't the island asked for. An island that failed on the
 * composer isn't thrown: it's an entry with `status: "error"`.
 */
export class IslandFetchError extends Error {
  readonly status: number;
  readonly body: string;
  /** The protocol error code from the response body (e.g. "invalid_cursor"), if there was one. */
  readonly code: string | undefined;

  constructor(status: number, body: string) {
    super(`Island request failed with status ${status}`);
    this.status = status;
    this.body = body;
    this.code = errorCode(body);
  }
}

function isIslandResponse(value: unknown): value is IslandResponse {
  return isRecord(value) && typeof value.screen === "string" && isIslandEntry(value.island);
}

/** Whether the answer is the island the request asked for, at the version it asked for. */
function isIslandAsked(island: IslandEntry, request: IslandRequest): boolean {
  return island.key === request.key && island.version === request.version;
}

// ---- Actions (spec §5) ----

/**
 * The composer didn't perform the action: a non-2xx response such as `invalid_input`,
 * `unauthenticated` or `action_failed`. Declared errors are not thrown; they're outcomes.
 */
export class ActionFetchError extends Error {
  readonly status: number;
  readonly body: string;
  /** The protocol error code from the response body (e.g. "unauthenticated"), if there was one. */
  readonly code: string | undefined;

  constructor(status: number, body: string) {
    super(`Action request failed with status ${status}`);
    this.status = status;
    this.body = body;
    this.code = errorCode(body);
  }
}

/** A fresh idempotency key: one per user intent, reused when retrying it (spec §5.2). */
export function newIdempotencyKey(): string {
  // React Native's Hermes may have no crypto, or crypto without randomUUID.
  const c: Partial<Pick<Crypto, "randomUUID">> | undefined = globalThis.crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  // React Native's Hermes has no crypto.randomUUID. Uniqueness, not secrecy, is what matters here.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function buildActionRequest<I>(
  action: ActionDescriptor<I, unknown, DeclaredError>,
  input: I,
  client: ClientContext,
  idempotencyKey?: string,
): ActionRequest<I> {
  return {
    protocol: PROTOCOL_VERSION,
    action: action.action,
    version: action.version,
    input,
    client,
    ...(idempotencyKey !== undefined && { idempotencyKey }),
  };
}

/**
 * POST an action request. Resolves with the outcome the composer sent (ok or an error); throws
 * ActionFetchError for a non-2xx response or a body that isn't an outcome. Check the outcome against
 * the action with `checkActionResponse` (callAction does).
 */
export async function fetchAction(
  baseUrl: string,
  request: ActionRequest,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ActionResponse> {
  const res = await fetchImpl(`${baseUrl}/actions/${encodeURIComponent(request.action)}`, {
    ...init,
    method: "POST",
    headers: jsonHeaders(init.headers),
    body: JSON.stringify(request),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ActionFetchError(res.status, text);
  }
  const response = parseJson(text);
  if (!isActionResponse(response)) {
    throw new ActionFetchError(res.status, text);
  }
  return response;
}

/**
 * The response, if it's a result or one of this action's own declared errors. Anything else throws
 * ActionFetchError (status 200, with the code if there is one): an outcome the client can't read,
 * or a code the action doesn't declare, such as one added after this app was built (spec §5.1).
 */
export function checkActionResponse<I, R, E extends DeclaredError>(
  action: ActionDescriptor<I, R, E>,
  response: unknown,
): ActionResponse<R, E> {
  const error = isRecord(response) ? response.error : undefined;
  const code = isRecord(error) ? error.code : undefined;
  const status = isRecord(response) ? response.status : undefined;
  const declared = status === "error" && typeof code === "string" && action.errors.includes(code);
  if (isActionResponse(response) && (status === "ok" || declared)) {
    // The result's and error's types are the action's: generated from its manifest, which the
    // composer checks its outcomes against. They exist only at the type level.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return response as ActionResponse<R, E>;
  }
  throw new ActionFetchError(200, JSON.stringify(response));
}

export interface CallActionOptions {
  client: ClientContext;
  /** Default: a new key. Pass the same key again to retry the same user intent. */
  idempotencyKey?: string;
  init?: RequestInit;
  fetch?: typeof fetch;
}

/**
 * Perform an action with its generated descriptor:
 *
 *     const res = await callAction(baseUrl, FollowUserV1, { userId }, { client });
 *     if (res.status === "ok") show(res.result.followers);
 *     else if (res.error.code === "blocked") showBlocked();
 *     else showGenericError(); // codes added after this app was built
 */
export async function callAction<I, R, E extends DeclaredError>(
  baseUrl: string,
  action: ActionDescriptor<I, R, E>,
  input: I,
  options: CallActionOptions,
): Promise<ActionResponse<R, E>> {
  const request = buildActionRequest(
    action,
    input,
    options.client,
    options.idempotencyKey ?? newIdempotencyKey(),
  );
  return checkActionResponse(
    action,
    await fetchAction(baseUrl, request, options.init, options.fetch),
  );
}
