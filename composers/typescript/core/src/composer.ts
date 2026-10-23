// The composer: screens and actions together, with plugins, served over any HTTP stack.

import {
  type ActionRequest,
  type Capabilities,
  type IslandEntry,
  type IslandRequest,
  PROTOCOL_VERSION,
  type ScreenRequest,
} from "@client-compose/protocol";

import { type Action, isActionRequestShape, performAction, protocolError } from "./actions.ts";
import { type Cache, type Idempotency, performIdempotent, resolveCached } from "./adapters.ts";
import { attachScope, InvalidCursorError, RequestScope } from "./loading.ts";
import type { ComposeFn, Failure, PerformFn, Plugin, ResolveFn } from "./plugins.ts";
import { type ComposeResult, fail, type IslandResult, type PerformResult } from "./results.ts";
import {
  type Island,
  type LayoutContext,
  negotiate,
  type Page,
  type Placement,
  type Screen,
} from "./screens.ts";

export interface ComposerConfig<Ctx, Req = Request> {
  screens?: Screen<Ctx>[];
  actions?: Action<Ctx>[];
  /**
   * Turns each incoming request into your app's context, which every requirement, layout, island
   * and action receives: the viewer from a session or token, their locale, a tenant. `Req` is your
   * server's request type: a fetch `Request` by default, or what your adapter passes (Express,
   * Fastify, node:http). Throw UnauthenticatedError or ForbiddenError to answer 401 or 403.
   */
  context?: (request: Req) => Ctx | Promise<Ctx>;
  /** Plugins, outermost first. */
  use?: Plugin<Ctx, Req>[];
  /**
   * Serves islands that opt in with `cache` (CMP-18). Without it, every island resolves on every
   * request.
   */
  cache?: Cache;
  /**
   * Runs each action at most once per scope and idempotency key (CMP-19). Without it, keys pass
   * through to actions.
   */
  idempotency?: Idempotency<Ctx>;
  /** Each island's timeout unless its placement sets one. Default 2000. */
  defaultTimeoutMs?: number;
}

/** What `handle` answers: a status and a JSON body. */
export interface HandleResult {
  status: number;
  body: unknown;
}

export interface Composer<Ctx, Req = Request> {
  /**
   * Fetch-standard handler (Bun, Deno, Cloudflare Workers, Hono, Next.js route handlers). Answers
   * POST requests whose path ends in /screens/{screen}, /screens/{screen}/islands/{key} or
   * /actions/{action}, so it works under any prefix.
   *
   *     export default { fetch: composer.fetch };
   */
  fetch: [Req] extends [Request] ? (request: Request) => Promise<Response> : never;
  /**
   * For adapters: answer a POST to a path ending in /screens/{screen},
   * /screens/{screen}/islands/{key} or /actions/{action}, given its raw body and your server's
   * request (for `context`). Returns undefined for any other path.
   */
  handle(path: string, body: string, request: Req): Promise<HandleResult | undefined>;
  /** Compose a screen in-process, with a context you provide. Tests use the testing kit instead. */
  compose(req: ScreenRequest, ctx: Ctx): Promise<ComposeResult>;
  /**
   * Resolve one island of a screen in-process (spec §4.5): its next page, for a request with a
   * cursor, or from its first page without one.
   */
  composeIsland(req: IslandRequest, ctx: Ctx): Promise<IslandResult>;
  /** Perform an action in-process, with a context you provide. */
  perform(req: ActionRequest, ctx: Ctx): Promise<PerformResult>;
  /** The islands placed by screens with declared `islands`, as a client would declare them. */
  islands(): Capabilities;
}

/**
 * Build a composer:
 *
 *     const composer = createComposer({
 *       screens: [profile],
 *       actions: [followUser],
 *       context: async (request) => ({ viewer: await sessions.viewer(request) }),
 *       use: [reportErrors(console.error)],
 *     });
 *     export default { fetch: composer.fetch };
 */
export function createComposer<Ctx = undefined, Req = Request>(
  config: ComposerConfig<Ctx, Req>,
): Composer<Ctx, Req> {
  const screens = new Map<string, Screen<Ctx>>();
  for (const s of config.screens ?? []) {
    if (screens.has(s.id)) throw new Error(`Screen "${s.id}" is defined twice`);
    if ((s.islands === undefined) === (s.layout === undefined))
      throw new Error(`Screen "${s.id}" needs either islands or layout`);
    screens.set(s.id, s);
  }
  const actions = new Map<string, Map<number, Action<Ctx>>>();
  for (const a of config.actions ?? []) {
    const { action, version } = a.descriptor;
    if (!actions.has(action)) actions.set(action, new Map());
    if (actions.get(action)!.has(version))
      throw new Error(`Action ${action} v${version} is defined twice`);
    actions.get(action)!.set(version, a);
  }
  const plugins = config.use ?? [];
  const defaultTimeoutMs = config.defaultTimeoutMs ?? 2000;

  const report = (failure: Failure) => {
    for (const p of plugins) {
      try {
        p.error?.(failure);
      } catch {
        // A failing reporter mustn't change the response.
      }
    }
  };

  let resolveChain: ResolveFn<Ctx> = (call) => resolveCached(config.cache, call, report);
  let composeChain: ComposeFn<Ctx> = (req, ctx) =>
    composeScreen(screens.get(req.screen)!, req, ctx);
  const performOnce = (req: ActionRequest, ctx: Ctx) =>
    performAction(actions.get(req.action)!.get(req.version)!, req, ctx, report);
  let performChain: PerformFn<Ctx> = (req, ctx) =>
    performIdempotent(config.idempotency, req, ctx, performOnce, report);
  for (const p of [...plugins].reverse()) {
    if (p.island) resolveChain = p.island(resolveChain);
    if (p.screen) composeChain = p.screen(composeChain);
    if (p.action) performChain = p.action(performChain);
  }

  async function compose(req: ScreenRequest, ctx: Ctx): Promise<ComposeResult> {
    if (req.protocol !== PROTOCOL_VERSION)
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    if (!screens.has(req.screen)) return fail(404, "unknown_screen", req.screen);
    return composeChain(req, ctx);
  }

  async function composeIsland(req: IslandRequest, ctx: Ctx): Promise<IslandResult> {
    if (req.protocol !== PROTOCOL_VERSION)
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    const screen = screens.get(req.screen);
    if (!screen) return fail(404, "unknown_screen", req.screen);
    // As for a screen: shared loads live as long as this request.
    const request = new AbortController();
    const scope = new RequestScope(request.signal);
    try {
      const load = scope.load.bind(scope);
      const lc: LayoutContext<Ctx> = attachScope(
        {
          screen: screen.id,
          params: req.params ?? {},
          client: req.client,
          ctx,
          load,
          cursor: req.cursor,
        },
        scope,
      );
      // The screen is laid out as it would be, so a page answers 401, 403 or 404 as it would.
      let placements: Placement<Ctx>[];
      try {
        placements = await placementsFor(screen, lc);
      } catch (err) {
        const res = protocolError(err);
        if (res) return res;
        report({ kind: "layout", screen: screen.id, error: err });
        return fail(500, "layout_failed");
      }
      const placement = placements.find((p) => p.key === req.key);
      if (!placement) return fail(404, "unknown_island", req.key);
      const island = placement.versions.find((v) => v.version === req.version);
      if (!island) return fail(400, "unsupported_island_version", `${req.key} v${req.version}`);
      if (req.cursor !== undefined && !island.paged)
        return fail(400, "invalid_cursor", `${req.key} has no pages`);

      const {
        required: _,
        cause,
        ...entry
      } = await resolveEntry(screen, placement, island, lc, scope);
      if (cause instanceof InvalidCursorError) return fail(400, "invalid_cursor");
      return {
        status: 200,
        body: { protocol: PROTOCOL_VERSION, screen: screen.id, island: entry as IslandEntry },
      };
    } finally {
      request.abort();
    }
  }

  async function perform(req: ActionRequest, ctx: Ctx): Promise<PerformResult> {
    if (req.protocol !== PROTOCOL_VERSION)
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    const versions = actions.get(req.action);
    if (!versions) return fail(404, "unknown_action", req.action);
    if (!versions.has(req.version))
      return fail(404, "unsupported_action_version", `${req.action} v${req.version}`);
    return performChain(req, ctx);
  }

  async function composeScreen(
    screen: Screen<Ctx>,
    req: ScreenRequest,
    ctx: Ctx,
  ): Promise<ComposeResult> {
    // Shared loads live as long as this request; whatever is still running when it's done is cancelled.
    const request = new AbortController();
    const scope = new RequestScope(request.signal);
    try {
      return await composeIn(screen, req, ctx, scope);
    } finally {
      request.abort();
    }
  }

  async function composeIn(
    screen: Screen<Ctx>,
    req: ScreenRequest,
    ctx: Ctx,
    scope: RequestScope,
  ): Promise<ComposeResult> {
    const params = req.params ?? {};
    const load = scope.load.bind(scope);
    const lc: LayoutContext<Ctx> = attachScope(
      { screen: screen.id, params, client: req.client, ctx, load },
      scope,
    );

    let placements: Placement<Ctx>[];
    try {
      placements = await placementsFor(screen, lc);
    } catch (err) {
      const res = protocolError(err);
      if (res) return res;
      report({ kind: "layout", screen: screen.id, error: err });
      return fail(500, "layout_failed");
    }
    // Started now so it runs alongside the islands (and can share their loads).
    const meta = screen.meta
      ? Promise.resolve()
          .then(() => screen.meta!(lc))
          .catch((error) => {
            report({ kind: "meta", screen: screen.id, error });
            return undefined;
          })
      : undefined;

    const negotiated = placements.map((p) => ({
      p,
      island: negotiate(p.versions, req.islands[p.versions[0]?.type]),
    }));
    const unplaceable = negotiated.find((n) => !n.island && n.p.required);
    if (unplaceable) return fail(502, "required_island_unsupported", unplaceable.p.key);

    const entries = await Promise.all(
      negotiated
        .filter(
          (n): n is { p: Placement<Ctx>; island: Island<Ctx, unknown> } => n.island !== undefined,
        )
        .map(({ p, island }) => resolveEntry(screen, p, island, lc, scope)),
    );
    const failedRequired = entries.find((e) => e.status === "error" && e.required);
    if (failedRequired) return fail(502, "required_island_failed", failedRequired.key);
    const screenMeta = await meta;

    return {
      status: 200,
      body: {
        protocol: PROTOCOL_VERSION,
        screen: screen.id,
        islands: entries.map(({ required: _, cause: __, ...e }) => e as IslandEntry),
        ...(screenMeta &&
          Object.values(screenMeta).some((v) => v !== undefined) && { meta: screenMeta }),
        ...(screen.cache && { cache: { maxAge: screen.cache.maxAge } }),
      },
    };
  }

  async function placementsFor(
    screen: Screen<Ctx>,
    lc: LayoutContext<Ctx>,
  ): Promise<Placement<Ctx>[]> {
    for (const requirement of screen.requires ?? []) {
      await requirement(lc.ctx, { screen: lc.screen, params: lc.params, client: lc.client });
    }
    if (screen.layout) return screen.layout(lc);
    const shown = await Promise.all(
      (screen.islands ?? []).map(async (p) => !p.when || (await p.when(lc))),
    );
    return (screen.islands ?? []).filter((_, i) => shown[i]);
  }

  async function resolveEntry(
    screen: Screen<Ctx>,
    p: Placement<Ctx>,
    island: Island<Ctx, unknown>,
    lc: LayoutContext<Ctx>,
    scope: RequestScope,
  ): Promise<IslandEntry & { required?: boolean; cause?: unknown }> {
    const base = { key: p.key, type: island.type, version: island.version };
    try {
      const resolved = await withTimeout(p.timeoutMs ?? defaultTimeoutMs, (signal) =>
        resolveChain({
          screen: screen.id,
          key: p.key,
          island,
          rc: attachScope({ ...lc, signal }, scope),
        }),
      );
      if (island.paged) {
        const page = (resolved ?? {}) as Page<unknown>;
        return {
          ...base,
          status: "ok",
          props: (page.props ?? {}) as Record<string, unknown>,
          ...(page.next && { next: page.next }),
        };
      }
      return { ...base, status: "ok", props: (resolved ?? {}) as Record<string, unknown> };
    } catch (error) {
      report({ kind: "island", screen: screen.id, key: p.key, type: island.type, error });
      const timedOut = error instanceof TimeoutError;
      return {
        ...base,
        status: "error",
        required: p.required,
        cause: error,
        error: { code: timedOut ? "timeout" : "resolve_failed", retryable: timedOut },
      };
    }
  }

  /** Runs `context` and the plugins' context hooks, or returns the response to send instead. */
  async function contextFor(
    request: Req,
    kind: Route["kind"],
  ): Promise<{ ctx: Ctx } | { res: HandleResult }> {
    try {
      let ctx = (config.context ? await config.context(request) : undefined) as Ctx;
      for (const p of plugins) {
        const extra = p.context ? await p.context(request, ctx) : undefined;
        if (extra) ctx = { ...ctx, ...extra };
      }
      return { ctx };
    } catch (error) {
      const res = protocolError(error);
      if (res) return { res };
      report({ kind: "context", error });
      return { res: fail(500, kind === "actions" ? "action_failed" : "layout_failed") };
    }
  }

  async function handle(
    path: string,
    body: string,
    request: Req,
  ): Promise<HandleResult | undefined> {
    const route = matchRoute(path);
    if (!route) return undefined;
    const context = await contextFor(request, route.kind);
    if ("res" in context) return context.res;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return fail(400, "bad_request", "Body is not valid JSON");
    }
    if (route.kind === "screens") {
      if (!isScreenRequestShape(parsed))
        return fail(400, "bad_request", "Body is not a screen request");
      if (parsed.protocol !== PROTOCOL_VERSION)
        return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
      if (parsed.screen !== route.name)
        return fail(400, "screen_mismatch", `${parsed.screen} != ${route.name}`);
      return compose(parsed, context.ctx);
    }
    if (route.kind === "islands") {
      if (!isIslandRequestShape(parsed))
        return fail(400, "bad_request", "Body is not an island request");
      if (parsed.protocol !== PROTOCOL_VERSION)
        return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
      if (parsed.screen !== route.name || parsed.key !== route.key)
        return fail(
          400,
          "island_mismatch",
          `${parsed.screen}/${parsed.key} != ${route.name}/${route.key}`,
        );
      return composeIsland(parsed, context.ctx);
    }
    if (!isActionRequestShape(parsed))
      return fail(400, "bad_request", "Body is not an action request");
    if (parsed.protocol !== PROTOCOL_VERSION)
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    if (parsed.action !== route.name)
      return fail(400, "action_mismatch", `${parsed.action} != ${route.name}`);
    return perform(parsed, context.ctx);
  }

  async function fetchHandler(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!matchRoute(path)) return new Response(null, { status: 404 });
    if (request.method !== "POST")
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    const res = (await handle(path, await request.text(), request as Req))!;
    return json(res.status, res.body);
  }

  function islands(): Capabilities {
    const out: Capabilities = {};
    for (const s of screens.values()) {
      for (const p of s.islands ?? []) {
        for (const v of p.versions) {
          const versions = (out[v.type] ??= []);
          if (!versions.includes(v.version)) versions.push(v.version);
        }
      }
    }
    for (const versions of Object.values(out)) versions.sort((a, b) => a - b);
    return out;
  }

  return {
    fetch: fetchHandler as Composer<Ctx, Req>["fetch"],
    handle,
    compose,
    composeIsland,
    perform,
    islands,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A composer route: a screen, one island of a screen (with its key), or an action. */
export interface Route {
  kind: "screens" | "islands" | "actions";
  /** The screen or action. */
  name: string;
  /** The island's key, for an island request. */
  key?: string;
}

/** The route a path ends in: /screens/{screen}, /screens/{screen}/islands/{key} or /actions/{action}. */
export function matchRoute(path: string): Route | undefined {
  const clean = path.split("?")[0];
  try {
    const island = clean.match(/\/screens\/([^/]+)\/islands\/([^/]+)\/?$/);
    if (island)
      return {
        kind: "islands",
        name: decodeURIComponent(island[1]),
        key: decodeURIComponent(island[2]),
      };
    const match = clean.match(/\/(screens|actions)\/([^/]+)\/?$/);
    if (!match) return undefined;
    return { kind: match[1] as "screens" | "actions", name: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
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

function isIslandRequestShape(v: unknown): v is IslandRequest {
  const r = v as IslandRequest;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.protocol === "number" &&
    typeof r.screen === "string" &&
    typeof r.key === "string" &&
    Number.isInteger(r.version) &&
    r.version >= 1 &&
    typeof r.client === "object" &&
    r.client !== null &&
    (r.cursor === undefined || typeof r.cursor === "string")
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
    return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
