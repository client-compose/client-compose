// Declaring screens: islands by their generated descriptors, placed on screens as data.

import type { ClientContext, IslandDescriptor, ScreenMeta } from "@client-compose/protocol";

import type { IslandCache } from "./adapters.ts";
import type { LoadContext } from "./loading.ts";
import type { Requirement } from "./plugins.ts";

/** What a layout, a placement's `when` and a screen's `meta` receive. */
export interface LayoutContext<Ctx> extends LoadContext {
  /** The screen being composed. */
  screen: string;
  params: Record<string, string>;
  client: ClientContext;
  /** Your app's context for this request, from the composer's `context` function. */
  ctx: Ctx;
  /**
   * Run `fn` once per `key` for this request, sharing the result with every island (and the layout)
   * that asks for the same key. `fn` gets the request's signal, not one island's, so an island
   * timing out never cancels work other islands are waiting on.
   *
   *     const user = await rc.load(`user:${id}`, (signal) => users.get(id, { signal }));
   */
  load: <T>(key: string, fn: (signal: AbortSignal) => Promise<T> | T) => Promise<T>;
}

/** What a resolver receives: the layout context, plus a signal aborted when this island times out. */
export interface ResolveContext<Ctx> extends LayoutContext<Ctx> {
  signal: AbortSignal;
}

/** One resolvable version of an island. Build one with `island`. */
export interface Island<Ctx, P = unknown> {
  type: string;
  version: number;
  resolve: (rc: ResolveContext<Ctx>) => Promise<P> | P;
  /** Cache the island's props, when the composer has a `Cache` (CMP-18). */
  cache?: IslandCache<Ctx>;
}

export interface IslandOptions<Ctx> {
  /**
   * Cache the island's props when the composer has a `Cache`:
   *
   *     island(TrendingV1, resolveTrending, { cache: { ttlMs: 300_000, key: () => "all" } })
   *     island(FeedV1, resolveFeed, { cache: { ttlMs: 30_000, key: ({ ctx, params }) => `${ctx.viewer?.id}:${params.page}` } })
   */
  cache?: IslandCache<Ctx>;
}

/**
 * Define how to resolve one island version, by its generated descriptor:
 *
 *     const ProfileHeader = island(ProfileHeaderV2, async ({ params, load }) => {
 *       const user = await load(`user:${params.userId}`, () => users.get(params.userId));
 *       return { displayName: user.name, avatarUrl: user.avatar };
 *     });
 */
export function island<P, Ctx = unknown>(
  descriptor: IslandDescriptor<P>,
  resolve: (rc: ResolveContext<Ctx>) => Promise<P> | P,
  options: IslandOptions<Ctx> = {},
): Island<Ctx, P> {
  return { type: descriptor.type, version: descriptor.version, resolve, ...options };
}

/** An island on a screen. Build one with `place` or `placeStatic`. */
export interface Placement<Ctx> {
  /** Unique on the screen, and stable across requests. */
  key: string;
  /** Every version you can resolve; the highest the client also supports is used (spec §4.2). */
  versions: Island<Ctx, unknown>[];
  /** Fail the whole screen if the island can't be placed or fails (spec §4.3). */
  required?: boolean;
  /** Overrides the composer's `defaultTimeoutMs` for this island. */
  timeoutMs?: number;
  /** Decides per request whether the island appears. */
  when?: (rc: LayoutContext<Ctx>) => boolean | Promise<boolean>;
}

export interface PlaceOptions<Ctx> {
  required?: boolean;
  timeoutMs?: number;
  when?: (rc: LayoutContext<Ctx>) => boolean | Promise<boolean>;
}

/**
 * Place an island on a screen, with one version or several:
 *
 *     place("header", ProfileHeader, { required: true })
 *     place("posts", [PostGridV1, PostGridV2], { timeoutMs: 300 })
 */
export function place<Ctx>(
  key: string,
  versions: Island<Ctx, unknown> | Island<Ctx, unknown>[],
  options: PlaceOptions<Ctx> = {},
): Placement<Ctx> {
  return { key, versions: Array.isArray(versions) ? versions : [versions], ...options };
}

/** Place an island whose props are known up front: a form, a heading. */
export function placeStatic<P, Ctx>(
  key: string,
  descriptor: IslandDescriptor<P>,
  props: P,
): Placement<Ctx> {
  return place(
    key,
    island<P, Ctx>(descriptor, () => props),
  );
}

/** What a screen is made of. Build one with `screen`. */
export interface Screen<Ctx> {
  id: string;
  /** Must all hold before anything else runs (401 or 403 otherwise). */
  requires?: Requirement<Ctx>[];
  /** The screen's islands, in order. Give either `islands` or `layout`. */
  islands?: Placement<Ctx>[];
  /**
   * Decide the islands per request, for screens that can't be declared up front (a CMS, an
   * experiment). Throw NotFoundError when what the params refer to doesn't exist (404 not_found),
   * or UnauthenticatedError / ForbiddenError (401 / 403).
   */
  layout?: (rc: LayoutContext<Ctx>) => Placement<Ctx>[] | Promise<Placement<Ctx>[]>;
  /**
   * Describe the screen as a whole (title, description, image). Runs alongside the islands and
   * shares their `load`s. If it fails, the response has no meta; the islands are unaffected.
   */
  meta?: (rc: LayoutContext<Ctx>) => ScreenMeta | Promise<ScreenMeta>;
  /** The cache hint clients get (spec §4). */
  cache?: { maxAge: number };
}

/**
 * Declare a screen:
 *
 *     const profile = screen("profile", {
 *       requires: [signedIn],
 *       islands: [place("header", ProfileHeader, { required: true }), place("posts", PostGrid)],
 *       cache: { maxAge: 30 },
 *     });
 */
export function screen<Ctx>(id: string, definition: Omit<Screen<Ctx>, "id">): Screen<Ctx> {
  if ((definition.islands === undefined) === (definition.layout === undefined)) {
    throw new Error(`Screen "${id}" needs either islands or layout`);
  }
  return { id, ...definition };
}

/** The highest version both sides support, or undefined (spec §4.2). */
export function negotiate<Ctx>(
  versions: Island<Ctx, unknown>[],
  supported: number[] | undefined,
): Island<Ctx, unknown> | undefined {
  if (!supported) return undefined;
  return versions
    .filter((v) => supported.includes(v.version))
    .sort((a, b) => b.version - a.version)[0];
}
