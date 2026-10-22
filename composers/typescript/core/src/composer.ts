// The composer: screens and actions together, with plugins, served over any HTTP stack.

import {
  type ActionRequest,
  type Capabilities,
  type IslandEntry,
  PROTOCOL_VERSION,
  type ScreenRequest,
} from "@client-compose/protocol";

import { type Action, isActionRequestShape, performAction, protocolError } from "./actions.ts";
import { attachScope, RequestScope } from "./loading.ts";
import type { ComposeFn, Failure, PerformFn, Plugin, ResolveFn } from "./plugins.ts";
import { type ComposeResult, fail, type PerformResult } from "./results.ts";
import {
  type Island,
  type LayoutContext,
  negotiate,
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
   * POST requests whose path ends in /screens/{screen} or /actions/{action}, so it works under any
   * prefix.
   *
   *     export default { fetch: composer.fetch };
   */
  fetch: [Req] extends [Request] ? (request: Request) => Promise<Response> : never;
  /**
   * For adapters: answer a POST to a path ending in /screens/{screen} or /actions/{action}, given its
   * raw body and your server's request (for `context`). Returns undefined for any other path.
   */
  handle(path: string, body: string, request: Req): Promise<HandleResult | undefined>;
  /** Compose a screen in-process, with a context you provide. Tests use the testing kit instead. */
  compose(req: ScreenRequest, ctx: Ctx): Promise<ComposeResult>;
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

  let resolveChain: ResolveFn<Ctx> = (call) => Promise.resolve(call.island.resolve(call.rc));
  let composeChain: ComposeFn<Ctx> = (req, ctx) =>
    composeScreen(screens.get(req.screen)!, req, ctx);
  let performChain: PerformFn<Ctx> = (req, ctx) =>
    performAction(actions.get(req.action)!.get(req.version)!, req, ctx, report);
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
        islands: entries.map(({ required: _, ...e }) => e as IslandEntry),
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
    for (const requirement of screen.requires ?? []) await requirement(lc.ctx);
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
  ): Promise<IslandEntry & { required?: boolean }> {
    const base = { key: p.key, type: island.type, version: island.version };
    try {
      const props = await withTimeout(p.timeoutMs ?? defaultTimeoutMs, (signal) =>
        resolveChain({
          screen: screen.id,
          key: p.key,
          island,
          rc: attachScope({ ...lc, signal }, scope),
        }),
      );
      return { ...base, status: "ok", props: (props ?? {}) as Record<string, unknown> };
    } catch (error) {
      report({ kind: "island", screen: screen.id, key: p.key, type: island.type, error });
      const timedOut = error instanceof TimeoutError;
      return {
        ...base,
        status: "error",
        required: p.required,
        error: { code: timedOut ? "timeout" : "resolve_failed", retryable: timedOut },
      };
    }
  }

  /** Runs `context` and the plugins' context hooks, or returns the response to send instead. */
  async function contextFor(
    request: Req,
    kind: "screens" | "actions",
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
      return { res: fail(500, kind === "screens" ? "layout_failed" : "action_failed") };
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

  return { fetch: fetchHandler as Composer<Ctx, Req>["fetch"], handle, compose, perform, islands };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The route a path ends in: /screens/{screen} or /actions/{action}. */
export function matchRoute(
  path: string,
): { kind: "screens" | "actions"; name: string } | undefined {
  const match = path.split("?")[0].match(/\/(screens|actions)\/([^/]+)\/?$/);
  if (!match) return undefined;
  try {
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
