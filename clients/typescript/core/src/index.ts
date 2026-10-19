// Framework-agnostic client core for JS/TS frontends (web, React Native, etc).
// `R` is whatever your UI layer renders: a React element, a DOM node, a string...

import {
  PROTOCOL_VERSION,
  type Capabilities,
  type ClientContext,
  type IslandDescriptor,
  type IslandEntry,
  type ScreenRequest,
  type ScreenResponse,
} from "@client-compose/protocol";

type OkEntry<P = any> = IslandEntry<P> & { status: "ok" };
type ErrorEntry = IslandEntry & { status: "error" };

export type IslandRenderer<R, P = any> = (props: P, entry: OkEntry<P>) => R;

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
    this.renderers.get(type)!.set(version, render);
    return this;
  }

  capabilities(): Capabilities {
    return Object.fromEntries(
      [...this.renderers].map(([type, versions]) => [type, [...versions.keys()].sort((a, b) => a - b)]),
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
