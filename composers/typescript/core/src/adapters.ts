// Adapters (spec/CAPABILITIES.md): interfaces the composer uses, implemented by your app. Each is
// optional: without one, its feature is off.

import type { Failure } from "./plugins.ts";
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
  if (!cache || !opts) return call.island.resolve(call.rc);
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
