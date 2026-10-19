// Framework-agnostic composer. Adapters (express, fastify, hono, lambda...) only need to
// hand composeHttp() the path's screen id and the raw body, then write the result.

import {
  PROTOCOL_VERSION,
  type ClientContext,
  type IslandDescriptor,
  type IslandEntry,
  type ScreenErrorResponse,
  type ScreenRequest,
  type ScreenResponse,
} from "@client-compose/protocol";

export { conformanceScreen } from "./conformance.ts";

export interface ResolveContext<Ctx> {
  params: Record<string, string>;
  client: ClientContext;
  /** Whatever the adapter injects: auth, loaders, service clients, tracing. */
  ctx: Ctx;
  signal: AbortSignal;
}

/** One resolvable version of an island: how to produce its props. */
export interface IslandResolver<Ctx, P = Record<string, unknown>> {
  type: string;
  version: number;
  resolve: (rc: ResolveContext<Ctx>) => Promise<P> | P;
}

/**
 * Define how to resolve one island version. With a generated descriptor:
 * `defineIsland(ProfileHeaderV2, async ({ params, ctx }) => ({ ... }))`.
 */
export function defineIsland<P, Ctx = unknown>(
  island: IslandDescriptor<P>,
  resolve: IslandResolver<Ctx, P>["resolve"],
): IslandResolver<Ctx, P>;
export function defineIsland<P, Ctx = unknown>(island: IslandResolver<Ctx, P>): IslandResolver<Ctx, P>;
export function defineIsland<P, Ctx>(
  island: IslandDescriptor<P> | IslandResolver<Ctx, P>,
  resolve?: IslandResolver<Ctx, P>["resolve"],
): IslandResolver<Ctx, P> {
  return resolve ? { type: island.type, version: island.version, resolve } : (island as IslandResolver<Ctx, P>);
}

export interface Placement<Ctx> {
  key: string;
  /** All resolvable versions of one island type; the best client-supported one wins. */
  island: IslandResolver<Ctx, any>[];
  required?: boolean;
  timeoutMs?: number;
}

export interface ScreenDefinition<Ctx> {
  id: string;
  /** Decide which islands appear. Can branch on client, params, flags, experiments. */
  layout: (rc: Omit<ResolveContext<Ctx>, "signal">) => Placement<Ctx>[] | Promise<Placement<Ctx>[]>;
  cacheMaxAge?: number;
}

export function defineScreen<Ctx>(screen: ScreenDefinition<Ctx>): ScreenDefinition<Ctx> {
  return screen;
}

export type ComposeResult =
  | { status: 200; body: ScreenResponse }
  | { status: 400 | 404 | 500 | 502; body: ScreenErrorResponse };

export interface ComposerOptions {
  defaultTimeoutMs?: number;
  onIslandError?: (key: string, type: string, err: unknown) => void;
}

/** Highest version both sides support, or undefined (spec §4.2). */
export function negotiate<Ctx>(
  versions: IslandResolver<Ctx, unknown>[],
  supported: number[] | undefined,
): IslandResolver<Ctx, unknown> | undefined {
  if (!supported) return undefined;
  return versions
    .filter((v) => supported.includes(v.version))
    .sort((a, b) => b.version - a.version)[0];
}

const fail = (status: 400 | 404 | 500 | 502, code: string, message?: string): ComposeResult => ({
  status,
  body: { protocol: PROTOCOL_VERSION, error: { code, message } },
});

export function createComposer<Ctx>(
  screens: ScreenDefinition<Ctx>[],
  options: ComposerOptions = {},
) {
  const byId = new Map(screens.map((s) => [s.id, s]));
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 2000;

  return async function compose(req: ScreenRequest, ctx: Ctx): Promise<ComposeResult> {
    if (req.protocol !== PROTOCOL_VERSION) {
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    }
    const screen = byId.get(req.screen);
    if (!screen) return fail(404, "unknown_screen", req.screen);

    const params = req.params ?? {};
    let placements: Placement<Ctx>[];
    try {
      placements = await screen.layout({ params, client: req.client, ctx });
    } catch {
      return fail(500, "layout_failed");
    }

    const negotiated = placements.map((p) => ({ p, resolver: negotiate(p.island, req.islands[p.island[0]?.type]) }));
    const unplaceable = negotiated.find((n) => !n.resolver && n.p.required);
    if (unplaceable) {
      return fail(502, "required_island_unsupported", unplaceable.p.key);
    }

    const entries = await Promise.all(
      negotiated
        .filter((n) => n.resolver)
        .map(async ({ p, resolver }): Promise<IslandEntry & { required?: boolean }> => {
          const r = resolver!;
          const base = { key: p.key, type: r.type, version: r.version };
          try {
            const props = await withTimeout(p.timeoutMs ?? defaultTimeoutMs, (signal) =>
              r.resolve({ params, client: req.client, ctx, signal }),
            );
            return { ...base, status: "ok", props: props as Record<string, unknown> };
          } catch (err) {
            options.onIslandError?.(p.key, r.type, err);
            const timedOut = err instanceof TimeoutError;
            return {
              ...base,
              status: "error",
              required: p.required,
              error: { code: timedOut ? "timeout" : "resolve_failed", retryable: timedOut },
            };
          }
        }),
    );

    const failedRequired = entries.find((e) => e.status === "error" && e.required);
    if (failedRequired) return fail(502, "required_island_failed", failedRequired.key);

    return {
      status: 200,
      body: {
        protocol: PROTOCOL_VERSION,
        screen: screen.id,
        islands: entries.map(({ required: _, ...e }) => e as IslandEntry),
        ...(screen.cacheMaxAge !== undefined && { cache: { maxAge: screen.cacheMaxAge } }),
      },
    };
  };
}

/** Parse, validate and compose an HTTP request body (spec §8.1 error codes). */
export async function composeHttp<Ctx>(
  compose: ReturnType<typeof createComposer<Ctx>>,
  pathScreen: string,
  rawBody: string,
  ctx: Ctx,
): Promise<ComposeResult> {
  let req: ScreenRequest;
  try {
    req = JSON.parse(rawBody);
  } catch {
    return fail(400, "bad_request", "Body is not valid JSON");
  }
  if (!isScreenRequestShape(req)) return fail(400, "bad_request", "Body is not a screen request");
  if (req.protocol !== PROTOCOL_VERSION) {
    return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
  }
  if (req.screen !== pathScreen) return fail(400, "screen_mismatch", `${req.screen} != ${pathScreen}`);
  return compose(req, ctx);
}

function isScreenRequestShape(v: unknown): v is ScreenRequest {
  const r = v as ScreenRequest;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.protocol === "number" &&
    typeof r.screen === "string" &&
    typeof r.client === "object" &&
    r.client !== null &&
    typeof r.islands === "object" &&
    r.islands !== null
  );
}

class TimeoutError extends Error {}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject before aborting: abort listeners fire synchronously and would win the race.
      reject(new TimeoutError(`Timed out after ${ms}ms`));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve(fn(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
