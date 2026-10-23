// Adapters (spec/CAPABILITIES.md): interfaces the composer uses, implemented by your app. Each is
// optional: without one, its feature is off.

import type { ActionRequest } from "@client-compose/protocol";

import type { Failure } from "./plugins.ts";
import { fail, type PerformResult } from "./results.ts";
import type { Island, LayoutContext } from "./screens.ts";

/**
 * Keeps island props between requests (CMP-18). Implement it with whatever your app runs: Redis,
 * Memcached, a Map. It's optional: without one (`cache` in the composer's config), islands resolve
 * on every request, whether they opt in or not.
 *
 *     const redisCache: Cache = {
 *       get: async (key) => (await redis.get(key)) ?? undefined,
 *       set: async (key, value, ttlMs) => { await redis.set(key, value, { PX: ttlMs }); },
 *     };
 */
export interface Cache {
  /** The value stored under `key`, or undefined. */
  get(key: string): Promise<string | undefined> | string | undefined;
  /** Store `value` under `key` for `ttlMs`. */
  set(key: string, value: string, ttlMs: number): Promise<void> | void;
}

/** How an island is cached, when the composer has a `Cache`. */
export interface IslandCache<Ctx> {
  ttlMs: number;
  /**
   * What the island's props depend on for this request: the params it reads, the viewer for a
   * personalised island, the locale. Return undefined (or "") to skip the cache for this request,
   * e.g. when someone is signed in. The island's type and version are added to the key.
   */
  key: (rc: LayoutContext<Ctx>) => string | undefined;
}

/**
 * The innermost island resolver: from the cache when the island opts in and the composer has one,
 * otherwise by the island's own function. Failures are never cached; a cache that errors is
 * reported and bypassed.
 */
export async function resolveCached<Ctx>(
  cache: Cache | undefined,
  call: {
    screen: string;
    key: string;
    island: Island<Ctx, unknown>;
    rc: Parameters<Island<Ctx, unknown>["resolve"]>[0];
  },
  report: (failure: Failure) => void,
): Promise<unknown> {
  const opts = call.island.cache;
  // A page depends on its cursor, and the cache keeps props alone, not where they go on.
  if (!cache || !opts || call.island.paged) return call.island.resolve(call.rc);
  const appKey = opts.key(call.rc);
  if (!appKey) return call.island.resolve(call.rc);
  const key = `island:${call.island.type}:${call.island.version}:${appKey}`;
  const failed = (error: unknown) =>
    report({ kind: "cache", screen: call.screen, key: call.key, type: call.island.type, error });

  try {
    const cached = await cache.get(key);
    if (cached !== undefined) return JSON.parse(cached);
  } catch (error) {
    failed(error);
  }
  const props = await call.island.resolve(call.rc);
  try {
    await cache.set(key, JSON.stringify(props ?? {}), opts.ttlMs);
  } catch (error) {
    failed(error);
  }
  return props;
}

/**
 * Keeps action outcomes by idempotency key (CMP-19), so a retried action returns its first outcome
 * instead of running again. Implement it with whatever your app runs; with Redis, `begin` is a
 * `SET NX` of a "running" marker, `finish` a `SET` of the outcome, and `release` a `DEL`. It's
 * optional: without `idempotency` in the composer's config, keys pass through to your actions.
 */
export interface IdempotencyStore {
  /**
   * Claim `key` for `ttlMs`. If a call with this key has finished, return its stored outcome
   * instead; if another call holds the key and hasn't finished, return `{ claimed: false }`.
   */
  begin(
    key: string,
    ttlMs: number,
  ): Promise<{ stored?: string; claimed: boolean }> | { stored?: string; claimed: boolean };
  /** Store the outcome of the call that claimed `key`, for `ttlMs`. */
  finish(key: string, outcome: string, ttlMs: number): Promise<void> | void;
  /** Drop a claim without an outcome, so a retry runs the action again. */
  release(key: string): Promise<void> | void;
}

/** The composer's idempotency settings (CMP-19). */
export interface Idempotency<Ctx> {
  store: IdempotencyStore;
  /**
   * Whose keys these are, usually the viewer's id, so one caller can never replay another's.
   * Return "" for actions anyone may share.
   */
  scope: (ctx: Ctx) => string;
  /** How long outcomes are kept. Default 24 hours. */
  ttlMs?: number;
  /** How long a duplicate waits for a call with its key that's still running. Default 10 seconds. */
  waitMs?: number;
}

/**
 * Runs an action at most once per scope and idempotency key. Only completed outcomes (results and
 * declared errors) are kept; anything else releases the key, so a retry runs again. A store that
 * errors is reported, and the action runs.
 */
export async function performIdempotent<Ctx>(
  idempotency: Idempotency<Ctx> | undefined,
  req: ActionRequest,
  ctx: Ctx,
  perform: (req: ActionRequest, ctx: Ctx) => Promise<PerformResult>,
  report: (failure: Failure) => void,
): Promise<PerformResult> {
  if (!idempotency || !req.idempotencyKey) return perform(req, ctx);
  const { store } = idempotency;
  const ttlMs = idempotency.ttlMs ?? 24 * 60 * 60 * 1000;
  const key = `action:${req.action}:${req.version}:${idempotency.scope(ctx)}:${req.idempotencyKey}`;
  const failed = (error: unknown) =>
    report({ kind: "idempotency", action: req.action, version: req.version, error });

  const deadline = Date.now() + (idempotency.waitMs ?? 10_000);
  for (;;) {
    let begun: { stored?: string; claimed: boolean };
    try {
      begun = await store.begin(key, ttlMs);
    } catch (error) {
      failed(error);
      return perform(req, ctx);
    }
    if (begun.stored !== undefined) return { status: 200, body: JSON.parse(begun.stored) };
    if (begun.claimed) break;
    if (Date.now() > deadline) {
      failed(new Error(`idempotency ${key}: still running`));
      return fail(500, "action_failed", "a call with this idempotency key is still running");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const res = await perform(req, ctx);
  try {
    if (res.status === 200) await store.finish(key, JSON.stringify(res.body), ttlMs);
    else await store.release(key);
  } catch (error) {
    failed(error);
  }
  return res;
}
