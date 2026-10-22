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
  PROTOCOL_VERSION,
  type ScreenRequest,
  type ScreenResponse,
} from "@client-compose/protocol";

type OkEntry<P = unknown> = IslandEntry<P> & { status: "ok" };
type ErrorEntry = IslandEntry & { status: "error" };

export type IslandRenderer<R, P = unknown> = (props: P, entry: OkEntry<P>) => R;

export class IslandRegistry<R> {
  private renderers = new Map<string, Map<number, IslandRenderer<R>>>();

  /** Register a renderer for a generated island descriptor: `register(ProfileHeaderV2, (props) => …)`. */
  register<P>(island: IslandDescriptor<P>, render: IslandRenderer<R, P>): this;
  register<P>(type: string, version: number, render: IslandRenderer<R, P>): this;
  register<P>(
    islandOrType: IslandDescriptor<P> | string,
    versionOrRender: number | IslandRenderer<R, P>,
    maybeRender?: IslandRenderer<R, P>,
  ): this {
    const [type, version, render] =
      typeof islandOrType === "string"
        ? [islandOrType, versionOrRender as number, maybeRender!]
        : [islandOrType.type, islandOrType.version, versionOrRender as IslandRenderer<R, P>];
    if (!this.renderers.has(type)) this.renderers.set(type, new Map());
    // The registry hands each renderer the props of its own island type and version.
    this.renderers.get(type)!.set(version, render as IslandRenderer<R>);
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
}

export function buildRequest(
  registry: IslandRegistry<unknown>,
  screen: string,
  client: ClientContext,
  params?: Record<string, string>,
): ScreenRequest {
  return { protocol: PROTOCOL_VERSION, screen, params, client, islands: registry.capabilities() };
}

export interface PlannedIsland<R> {
  key: string;
  render: () => R;
}

export type SkipReason = "unknown_island" | "unknown_status";

export interface PlanOptions<R> {
  /** Render something for errored islands. Default: omit them (spec §4.3). */
  onError?: (entry: ErrorEntry) => R | undefined;
  /** Called for islands the client can't render (spec §4.4). Useful for telemetry. */
  onSkipped?: (entry: IslandEntry, reason: SkipReason) => void;
}

/** Turn a response into an ordered list of renderable islands. */
export function plan<R>(
  registry: IslandRegistry<R>,
  response: ScreenResponse,
  options: PlanOptions<R> = {},
): PlannedIsland<R>[] {
  const out: PlannedIsland<R>[] = [];
  for (const entry of response.islands) {
    if (entry.status === "error") {
      const fallback = options.onError?.(entry);
      if (fallback !== undefined) out.push({ key: entry.key, render: () => fallback });
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
    out.push({ key: entry.key, render: () => renderer(entry.props, entry) });
  }
  return out;
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
    const code = (JSON.parse(body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchScreen(
  baseUrl: string,
  request: ScreenRequest,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ScreenResponse> {
  const res = await fetchImpl(`${baseUrl}/screens/${encodeURIComponent(request.screen)}`, {
    ...init,
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new ScreenFetchError(res.status, await res.text());
  return (await res.json()) as ScreenResponse;
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
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
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
    headers: { "content-type": "application/json", ...init.headers },
    body: JSON.stringify(request),
  });
  const text = await res.text();
  if (!res.ok) throw new ActionFetchError(res.status, text);
  try {
    return JSON.parse(text) as ActionResponse;
  } catch {
    throw new ActionFetchError(res.status, text);
  }
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
  const r = response as { status?: unknown; error?: { code?: unknown } } | null;
  const declared =
    r?.status === "error" &&
    typeof r.error?.code === "string" &&
    action.errors.includes(r.error.code);
  if (r?.status === "ok" || declared) return response as ActionResponse<R, E>;
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
