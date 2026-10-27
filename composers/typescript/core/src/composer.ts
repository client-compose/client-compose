// The composer: screens and actions together, with plugins, served over any HTTP stack.

import {
  type ActionRequest,
  type Capabilities,
  type IslandEntry,
  type IslandRequest,
  PROTOCOL_VERSION,
  type ScreenErrorResponse,
  type ScreenRequest,
  type StringsRequest,
} from "@client-compose/protocol";

import { type Action, isActionRequestShape, performAction, protocolError } from "./actions.ts";
import { type Cache, type Idempotency, performIdempotent, resolveCached } from "./adapters.ts";
import { isRecord } from "./guards.ts";
import { attachScope, InvalidCursorError, RequestScope } from "./loading.ts";
import type { ComposeFn, Failure, PerformFn, Plugin, ResolveFn } from "./plugins.ts";
import {
  type ComposeResult,
  fail,
  type IslandResult,
  type PerformResult,
  type StringsResult,
} from "./results.ts";
import {
  type Island,
  type LayoutContext,
  negotiate,
  type Placement,
  type Screen,
} from "./screens.ts";
import { inOrderResolved, isScreenStream, streamLines } from "./stream.ts";
import { type LocaleStrings, type StringsConfig, stringsFor } from "./strings.ts";

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
  /**
   * The words islands and the app show, in each language (spec §4.7): `loadCatalog("strings")`.
   * Without it, entries carry no strings, and POST /strings answers 404.
   */
  strings?: StringsConfig;
}

/**
 * What `handle` answers: a status, and a body of that content type. A screen's is its stream, as
 * JSON lines (`application/jsonl`, spec §4.6), to send as each arrives; everything else is JSON.
 */
export interface HandleResult {
  status: number;
  contentType: "application/json" | "application/jsonl";
  body: string | AsyncIterable<string>;
}

export interface Composer<Ctx, Req = Request> {
  /**
   * Fetch-standard handler (Bun, Deno, Cloudflare Workers, Hono, Next.js route handlers). Answers
   * POST requests whose path ends in /screens/{screen}, /screens/{screen}/islands/{key},
   * /actions/{action} or /strings, so it works under any prefix.
   *
   *     export default { fetch: composer.fetch };
   */
  fetch: [Req] extends [Request] ? (request: Request) => Promise<Response> : never;
  /**
   * For adapters: answer a POST to a path ending in /screens/{screen},
   * /screens/{screen}/islands/{key}, /actions/{action} or /strings, given its raw body and your
   * server's request (for `context`). Returns undefined for any other path.
   */
  handle(path: string, body: string, request: Req): Promise<HandleResult | undefined>;
  /**
   * Compose a screen in-process, with a context you provide: its stream, or its error. `collect`
   * puts a stream together. Tests use the testing kit instead.
   */
  compose(req: ScreenRequest, ctx: Ctx): Promise<ComposeResult>;
  /**
   * Resolve one island of a screen in-process (spec §4.5): its next page, for a request with a
   * cursor, or from its first page without one.
   */
  composeIsland(req: IslandRequest, ctx: Ctx): Promise<IslandResult>;
  /** Perform an action in-process, with a context you provide. */
  perform(req: ActionRequest, ctx: Ctx): Promise<PerformResult>;
  /** The app strings in the client's language (spec §4.7). */
  appStrings(req: StringsRequest): StringsResult;
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
    if (screens.has(s.id)) {
      throw new Error(`Screen "${s.id}" is defined twice`);
    }
    if ((s.islands === undefined) === (s.layout === undefined)) {
      throw new Error(`Screen "${s.id}" needs either islands or layout`);
    }
    screens.set(s.id, s);
  }
  const actions = new Map<string, Map<number, Action<Ctx>>>();
  for (const a of config.actions ?? []) {
    const { action, version } = a.descriptor;
    const versions = actions.get(action) ?? new Map<number, Action<Ctx>>();
    if (versions.has(version)) {
      throw new Error(`Action ${action} v${version} is defined twice`);
    }
    versions.set(version, a);
    actions.set(action, versions);
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

  // compose and perform check a screen or action exists before the chains run.
  const screenOf = (id: string): Screen<Ctx> => {
    const found = screens.get(id);
    if (!found) {
      throw new Error(`No screen "${id}"`);
    }
    return found;
  };
  const actionOf = (name: string, version: number): Action<Ctx> => {
    const found = actions.get(name)?.get(version);
    if (!found) {
      throw new Error(`No action ${name} v${version}`);
    }
    return found;
  };

  let resolveChain: ResolveFn<Ctx> = (call) => resolveCached(config.cache, call, report);
  let composeChain: ComposeFn<Ctx> = (req, ctx) => composeScreen(screenOf(req.screen), req, ctx);
  const performOnce = (req: ActionRequest, ctx: Ctx) =>
    performAction(actionOf(req.action, req.version), req, ctx, report);
  let performChain: PerformFn<Ctx> = (req, ctx) =>
    performIdempotent(config.idempotency, req, ctx, performOnce, report);
  for (const p of [...plugins].reverse()) {
    if (p.island) {
      resolveChain = p.island(resolveChain);
    }
    if (p.screen) {
      composeChain = p.screen(composeChain);
    }
    if (p.action) {
      performChain = p.action(performChain);
    }
  }

  async function compose(req: ScreenRequest, ctx: Ctx): Promise<ComposeResult> {
    if (req.protocol !== PROTOCOL_VERSION) {
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    }
    if (!screens.has(req.screen)) {
      return fail(404, "unknown_screen", req.screen);
    }
    return composeChain(req, ctx);
  }

  async function composeIsland(req: IslandRequest, ctx: Ctx): Promise<IslandResult> {
    if (req.protocol !== PROTOCOL_VERSION) {
      return unsupportedProtocol();
    }
    const screen = screens.get(req.screen);
    if (!screen) {
      return fail(404, "unknown_screen", req.screen);
    }
    // As for a screen: shared loads live as long as this request.
    const request = new AbortController();
    const scope = new RequestScope(request.signal);
    try {
      return await composeIslandIn(screen, req, ctx, scope);
    } finally {
      request.abort();
    }
  }

  /**
   * One island, from the screen laid out as it would be for the request: its requirements, layout
   * and conditions run, so a page answers 401, 403 or 404 as the screen would.
   */
  async function composeIslandIn(
    screen: Screen<Ctx>,
    req: IslandRequest,
    ctx: Ctx,
    scope: RequestScope,
  ): Promise<IslandResult> {
    const load = scope.load.bind(scope);
    const fields = {
      screen: screen.id,
      params: req.params ?? {},
      client: req.client,
      ctx,
      load,
      cursor: req.cursor,
    };
    const lc: LayoutContext<Ctx> = attachScope(fields, scope);
    let placements: Placement<Ctx>[];
    try {
      placements = await placementsFor(screen, lc);
    } catch (err) {
      const res = protocolError(err);
      if (res) {
        return res;
      }
      report({
        kind: "layout",
        screen: screen.id,
        error: err,
      });
      return fail(500, "layout_failed");
    }
    const found = islandAsked(placements, req);
    if ("res" in found) {
      return found.res;
    }
    // A page's strings are the ones the client has from the screen (spec §4.5).
    const words = req.cursor === undefined ? wordsFor(req.client.locale) : undefined;
    const { entry, cause } = await resolveEntry(
      screen,
      found.placement,
      found.island,
      lc,
      scope,
      words,
    );
    if (cause instanceof InvalidCursorError) {
      return fail(400, "invalid_cursor");
    }
    return {
      status: 200,
      body: {
        protocol: PROTOCOL_VERSION,
        screen: screen.id,
        island: entry,
        ...(words && { locale: words.locale, plurals: words.plurals }),
      },
    };
  }

  async function perform(req: ActionRequest, ctx: Ctx): Promise<PerformResult> {
    if (req.protocol !== PROTOCOL_VERSION) {
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    }
    const versions = actions.get(req.action);
    if (!versions) {
      return fail(404, "unknown_action", req.action);
    }
    if (!versions.has(req.version)) {
      return fail(404, "unsupported_action_version", `${req.action} v${req.version}`);
    }
    return performChain(req, ctx);
  }

  async function composeScreen(
    screen: Screen<Ctx>,
    req: ScreenRequest,
    ctx: Ctx,
  ): Promise<ComposeResult> {
    // Shared loads live as long as this request: until its last island is resolved, or it fails.
    // Whatever is still running then is cancelled.
    const request = new AbortController();
    const scope = new RequestScope(request.signal);
    const end = () => request.abort();
    try {
      const res = await composeIn(screen, req, ctx, scope, end);
      if (res.status !== 200) {
        end();
      }
      return res;
    } catch (err) {
      end();
      throw err;
    }
  }

  async function composeIn(
    screen: Screen<Ctx>,
    req: ScreenRequest,
    ctx: Ctx,
    scope: RequestScope,
    end: () => void,
  ): Promise<ComposeResult> {
    const params = req.params ?? {};
    const load = scope.load.bind(scope);
    const lc: LayoutContext<Ctx> = attachScope(
      {
        screen: screen.id,
        params,
        client: req.client,
        ctx,
        load,
      },
      scope,
    );

    let placements: Placement<Ctx>[];
    try {
      placements = await placementsFor(screen, lc);
    } catch (err) {
      const res = protocolError(err);
      if (res) {
        return res;
      }
      report({
        kind: "layout",
        screen: screen.id,
        error: err,
      });
      return fail(500, "layout_failed");
    }
    // Started now so it runs alongside the islands (and can share their loads).
    const metaOf = screen.meta;
    const meta = metaOf
      ? Promise.resolve()
          .then(() => metaOf(lc))
          .catch((error) => {
            report({
              kind: "meta",
              screen: screen.id,
              error,
            });
            return undefined;
          })
      : undefined;

    const negotiated = placements.map((p) => ({
      p,
      island: negotiate(p.versions, req.islands[p.versions[0]?.type]),
    }));
    const unplaceable = negotiated.find((n) => !n.island && n.p.required);
    if (unplaceable) {
      return fail(502, "required_island_unsupported", unplaceable.p.key);
    }

    // Every island resolves at once; each records its entry when it's done.
    const placed = negotiated.filter(
      (n): n is { p: Placement<Ctx>; island: Island<Ctx, unknown> } => n.island !== undefined,
    );
    const words = wordsFor(req.client.locale);
    const done: (IslandEntry | undefined)[] = placed.map(() => undefined);
    const resolving = placed.map(({ p, island }, i) =>
      resolveEntry(screen, p, island, lc, scope, words).then(({ entry }) => {
        done[i] = entry;
        return entry;
      }),
    );
    void Promise.all(resolving).then(end);

    // The head waits for the required islands (spec §4.6): one failing fails the screen.
    const required = await Promise.all(resolving.filter((_, i) => placed[i]?.p.required));
    const failedRequired = required.find((e) => e.status === "error");
    if (failedRequired) {
      return fail(502, "required_island_failed", failedRequired.key);
    }
    const screenMeta = await meta;

    // It takes the other islands that are ready by then; the rest follow.
    const islands = placed.map(({ p, island }, i) => {
      return (
        done[i] ?? {
          key: p.key,
          type: island.type,
          version: island.version,
          status: "pending" as const,
        }
      );
    });
    const pending = resolving.filter((_, i) => done[i] === undefined);
    return {
      status: 200,
      body: {
        head: {
          protocol: PROTOCOL_VERSION,
          screen: screen.id,
          islands,
          ...(screenMeta &&
            Object.values(screenMeta).some((v) => v !== undefined) && { meta: screenMeta }),
          ...(screen.cache && { cache: { maxAge: screen.cache.maxAge } }),
          ...(words && { locale: words.locale, plurals: words.plurals }),
        },
        islands: inOrderResolved(pending),
      },
    };
  }

  async function placementsFor(
    screen: Screen<Ctx>,
    lc: LayoutContext<Ctx>,
  ): Promise<Placement<Ctx>[]> {
    for (const requirement of screen.requires ?? []) {
      await requirement(lc.ctx, {
        screen: lc.screen,
        params: lc.params,
        client: lc.client,
      });
    }
    if (screen.layout) {
      return screen.layout(lc);
    }
    const shown = await Promise.all(
      (screen.islands ?? []).map(async (p) => !p.when || (await p.when(lc))),
    );
    return (screen.islands ?? []).filter((_, i) => shown[i]);
  }

  /**
   * Resolves one island to its entry, and whether it's required. A failure is in its entry, and
   * returned as its `cause` too, so an island request can tell an invalid cursor from a failure.
   */
  async function resolveEntry(
    screen: Screen<Ctx>,
    p: Placement<Ctx>,
    island: Island<Ctx, unknown>,
    lc: LayoutContext<Ctx>,
    scope: RequestScope,
    words: LocaleStrings | undefined,
  ): Promise<{ entry: IslandEntry; required?: boolean; cause?: unknown }> {
    const base = {
      key: p.key,
      type: island.type,
      version: island.version,
    };
    try {
      const resolved = await withTimeout(p.timeoutMs ?? defaultTimeoutMs, (signal) =>
        resolveChain({
          screen: screen.id,
          key: p.key,
          island,
          rc: attachScope({ ...lc, signal }, scope),
        }),
      );
      // A paged island resolves to a page: its props, and where the next page starts.
      const page = island.paged && isRecord(resolved) ? resolved : undefined;
      const props = page ? page.props : resolved;
      const next = typeof page?.next === "string" && page.next !== "" ? page.next : undefined;
      const strings = words?.island(island.type, island.version);
      // Props are objects: the manifest's props schema says so (spec §2).
      const entry: IslandEntry = {
        ...base,
        status: "ok",
        props: isRecord(props) ? props : {},
        ...(next !== undefined && { next }),
        ...(strings && { strings }),
      };
      return { entry };
    } catch (error) {
      report({
        kind: "island",
        screen: screen.id,
        key: p.key,
        type: island.type,
        error,
      });
      const timedOut = error instanceof TimeoutError;
      const code = timedOut ? "timeout" : "resolve_failed";
      return {
        entry: {
          ...base,
          status: "error",
          error: { code, retryable: timedOut },
        },
        required: p.required,
        cause: error,
      };
    }
  }

  /** The catalog's words in the language nearest `locale`, if the composer has a catalog. */
  function wordsFor(locale: string | undefined): LocaleStrings | undefined {
    return config.strings ? stringsFor(config.strings, locale) : undefined;
  }

  function appStrings(req: StringsRequest): StringsResult {
    if (req.protocol !== PROTOCOL_VERSION) {
      return unsupportedProtocol();
    }
    const words = wordsFor(req.client.locale);
    if (!words) {
      return fail(404, "no_strings", "This composer has no strings catalog");
    }
    return {
      status: 200,
      body: {
        protocol: PROTOCOL_VERSION,
        locale: words.locale,
        plurals: words.plurals,
        strings: words.app(),
      },
    };
  }

  /** Runs `context` and the plugins' context hooks, or returns the response to send instead. */
  async function contextFor(
    request: Req,
    kind: Exclude<Route["kind"], "strings">,
  ): Promise<{ ctx: Ctx } | { res: { status: number; body: unknown } }> {
    try {
      // Without a context function, Ctx is undefined (createComposer's default): TypeScript can't
      // tie the two together.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      let ctx = (config.context ? await config.context(request) : undefined) as Ctx;
      for (const p of plugins) {
        const extra = p.context ? await p.context(request, ctx) : undefined;
        if (extra) {
          ctx = { ...ctx, ...extra };
        }
      }
      return { ctx };
    } catch (error) {
      const res = protocolError(error);
      if (res) {
        return { res };
      }
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
    if (!route) {
      return undefined;
    }
    const parsed = parseJson(body);
    // Strings are the same for everyone, signed in or not: an app needs them before anything.
    if (route.kind === "strings") {
      return answer(
        parsed.ok
          ? handleStrings(parsed.value)
          : fail(400, "bad_request", "Body is not valid JSON"),
      );
    }
    const context = await contextFor(request, route.kind);
    if ("res" in context) {
      return answer(context.res);
    }
    if (!parsed.ok) {
      return answer(fail(400, "bad_request", "Body is not valid JSON"));
    }
    switch (route.kind) {
      case "screens":
        return answer(await handleScreen(route.name, parsed.value, context.ctx));
      case "islands":
        return answer(await handleIsland(route.name, route.key, parsed.value, context.ctx));
      case "actions":
        return answer(await handleAction(route.name, parsed.value, context.ctx));
    }
  }

  /** A screen request (spec §3), checked against its path. */
  function handleScreen(
    screen: string,
    body: unknown,
    ctx: Ctx,
  ): Promise<ComposeResult> | ComposeResult {
    if (!isScreenRequestShape(body)) {
      return fail(400, "bad_request", "Body is not a screen request");
    }
    if (body.protocol !== PROTOCOL_VERSION) {
      return unsupportedProtocol();
    }
    if (body.screen !== screen) {
      return fail(400, "screen_mismatch", `${body.screen} != ${screen}`);
    }
    return compose(body, ctx);
  }

  /** An island request (spec §4.5), checked against its path. */
  function handleIsland(
    screen: string,
    key: string,
    body: unknown,
    ctx: Ctx,
  ): Promise<IslandResult> | IslandResult {
    if (!isIslandRequestShape(body)) {
      return fail(400, "bad_request", "Body is not an island request");
    }
    if (body.protocol !== PROTOCOL_VERSION) {
      return unsupportedProtocol();
    }
    if (body.screen !== screen || body.key !== key) {
      return fail(400, "island_mismatch", `${body.screen}/${body.key} != ${screen}/${key}`);
    }
    return composeIsland(body, ctx);
  }

  /** An action request (spec §5.2), checked against its path. */
  function handleAction(
    action: string,
    body: unknown,
    ctx: Ctx,
  ): Promise<PerformResult> | PerformResult {
    if (!isActionRequestShape(body)) {
      return fail(400, "bad_request", "Body is not an action request");
    }
    if (body.protocol !== PROTOCOL_VERSION) {
      return unsupportedProtocol();
    }
    if (body.action !== action) {
      return fail(400, "action_mismatch", `${body.action} != ${action}`);
    }
    return perform(body, ctx);
  }

  /** A strings request (spec §4.7). */
  function handleStrings(body: unknown): StringsResult {
    if (!isStringsRequestShape(body)) {
      return fail(400, "bad_request", "Body is not a strings request");
    }
    return appStrings(body);
  }

  async function fetchHandler(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!matchRoute(path)) {
      return new Response(null, { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    // fetch is only offered when Req is a fetch Request (Composer's type says so).
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const res = await handle(path, await request.text(), request as Req);
    if (!res) {
      return new Response(null, { status: 404 });
    }
    const body = typeof res.body === "string" ? res.body : encoded(res.body);
    return new Response(body, { status: res.status, headers: { "content-type": res.contentType } });
  }

  function islands(): Capabilities {
    const out: Capabilities = {};
    for (const s of screens.values()) {
      for (const p of s.islands ?? []) {
        for (const v of p.versions) {
          const versions = (out[v.type] ??= []);
          if (!versions.includes(v.version)) {
            versions.push(v.version);
          }
        }
      }
    }
    for (const versions of Object.values(out)) {
      versions.sort((a, b) => a - b);
    }
    return out;
  }

  return {
    // The same: Composer's fetch is `never` unless Req is a fetch Request.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    fetch: fetchHandler as Composer<Ctx, Req>["fetch"],
    handle,
    compose,
    composeIsland,
    perform,
    appStrings,
    islands,
  };
}

/** A result as `handle` answers it: a screen's stream as JSON lines, anything else as JSON. */
function answer(res: { status: number; body: unknown }): HandleResult {
  if (res.status === 200 && isScreenStream(res.body)) {
    return {
      status: 200,
      contentType: "application/jsonl",
      body: streamLines(res.body),
    };
  }
  return {
    status: res.status,
    contentType: "application/json",
    body: JSON.stringify(res.body),
  };
}

/** Lines as a byte stream, for a fetch Response. */
function encoded(lines: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = lines[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(next.value));
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** A composer route: a screen, one island of a screen (with its key), an action, or the strings. */
export type Route =
  | { kind: "strings" }
  | {
      kind: "screens" | "actions";
      /** The screen or action. */
      name: string;
    }
  | {
      kind: "islands";
      /** The screen. */
      name: string;
      /** The island's key on it. */
      key: string;
    };

const islandPath = /\/screens\/([^/]+)\/islands\/([^/]+)\/?$/;
const screenOrActionPath = /\/(screens|actions)\/([^/]+)\/?$/;
const stringsPath = /\/strings\/?$/;

/**
 * The route a path ends in: /screens/{screen}, /screens/{screen}/islands/{key}, /actions/{action}
 * or /strings.
 */
export function matchRoute(path: string): Route | undefined {
  const clean = path.split("?")[0];
  try {
    const island = islandPath.exec(clean);
    if (island) {
      return {
        kind: "islands",
        name: decodeURIComponent(island[1]),
        key: decodeURIComponent(island[2]),
      };
    }
    const match = screenOrActionPath.exec(clean);
    if (!match) {
      return stringsPath.test(clean) ? { kind: "strings" } : undefined;
    }
    const kind = match[1] === "screens" ? "screens" : "actions";
    return { kind, name: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
}

function unsupportedProtocol() {
  return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
}

/** A request body as JSON, or why not. */
function parseJson(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(body);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** The placement and version an island request asks for, or the error to answer with. */
function islandAsked<Ctx>(
  placements: Placement<Ctx>[],
  req: IslandRequest,
):
  | { placement: Placement<Ctx>; island: Island<Ctx, unknown> }
  | { res: { status: 400 | 404; body: ScreenErrorResponse } } {
  const placement = placements.find((p) => p.key === req.key);
  if (!placement) {
    return { res: fail(404, "unknown_island", req.key) };
  }
  const island = placement.versions.find((v) => v.version === req.version);
  if (!island) {
    return { res: fail(400, "unsupported_island_version", `${req.key} v${req.version}`) };
  }
  if (req.cursor !== undefined && !island.paged) {
    return { res: fail(400, "invalid_cursor", `${req.key} has no pages`) };
  }
  return { placement, island };
}

// Each shape check returns at the first thing a request gets wrong.

function isScreenRequestShape(v: unknown): v is ScreenRequest {
  if (!isRecord(v) || typeof v.protocol !== "number") {
    return false;
  }
  if (typeof v.screen !== "string") {
    return false;
  }
  return isRecord(v.client) && isRecord(v.islands);
}

function isIslandRequestShape(v: unknown): v is IslandRequest {
  if (!isRecord(v) || typeof v.protocol !== "number") {
    return false;
  }
  if (typeof v.screen !== "string" || typeof v.key !== "string") {
    return false;
  }
  if (typeof v.version !== "number" || !Number.isInteger(v.version) || v.version < 1) {
    return false;
  }
  if (v.cursor !== undefined && typeof v.cursor !== "string") {
    return false;
  }
  return isRecord(v.client);
}

function isStringsRequestShape(v: unknown): v is StringsRequest {
  return isRecord(v) && typeof v.protocol === "number" && isRecord(v.client);
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
