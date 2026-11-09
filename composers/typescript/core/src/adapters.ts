// Adapters (spec/CAPABILITIES.md): interfaces the composer uses, implemented by your app. Each is
// optional: without one, its feature is off.

import type { ActionRequest, EntityPath } from "@client-compose/protocol";

import { isRecord } from "./guards.ts";
import type { Failure } from "./plugins.ts";
import { fail, type PerformResult } from "./results.ts";
import type { Island, LayoutContext } from "./screens.ts";

/**
 * Keeps island props between requests (CMP-18). Implement it with whatever your app runs: Redis,
 * Memcached, a Map. It's optional: without one (`cache` in the composer's config), islands resolve
 * on every request, whether they opt in or not.
 *
 * Each entry is filed under tags: the island it is (its type, version and key) and each entity its
 * props hold. After an action, the composer invalidates the tags of what its effects say changed,
 * so a change shows on the next request, from every composer sharing the cache. With Redis, keep
 * each tag as a set of keys:
 *
 *     const redisCache: Cache = {
 *       get: async (key) => (await redis.get(key)) ?? undefined,
 *       set: async (key, value, ttlMs, tags) => {
 *         const tx = redis.multi().set(key, value, { PX: ttlMs });
 *         for (const tag of tags) tx.sAdd(tag, key).pExpire(tag, ttlMs);
 *         await tx.exec();
 *       },
 *       invalidate: async (tags) => {
 *         for (const tag of tags) {
 *           const keys = await redis.sMembers(tag);
 *           if (keys.length) await redis.multi().unlink(keys).sRem(tag, keys).exec();
 *         }
 *       },
 *     };
 */
export interface Cache {
  /** The value stored under `key`, or undefined. */
  get(key: string): Promise<string | undefined> | string | undefined;
  /** Store `value` under `key` for `ttlMs`, filed under each of `tags`. */
  set(key: string, value: string, ttlMs: number, tags: readonly string[]): Promise<void> | void;
  /** Remove every value filed under any of `tags`. */
  invalidate(tags: readonly string[]): Promise<void> | void;
}

/** How an island is cached, when the composer has a `Cache`. */
export interface IslandCache<Ctx> {
  /** How long it can be out of date if something changes other than through an action's effects. */
  ttlMs: number;
  /**
   * What the island's props depend on for this request: the params it reads, the locale. Return
   * undefined (or "") to skip the cache for this request. The island's type and version are added
   * to the key. An action invalidates the entries its caller's key names, so an island that some
   * people see differently from others is best split into islands that are each the same for
   * everyone who sees them.
   */
  key: (rc: LayoutContext<Ctx>) => string | undefined;
}

/** The tag of an island's entry. */
export function islandTag(island: { type: string; version: number }, appKey: string): string {
  return `tag:island:${island.type}:${island.version}:${appKey}`;
}

/** The tag of every entry holding one entity. */
export function entityTag(entity: string, id: string): string {
  return `tag:entity:${entity}:${id}`;
}

/** The entities props hold, by the island's entity paths (spec §2.1), as tags. */
function heldTags(props: unknown, paths: readonly EntityPath[] | undefined): string[] {
  const out: string[] = [];
  const walk = (value: unknown, path: EntityPath, rest: readonly string[]) => {
    if (rest.length === 0) {
      const id = isRecord(value) ? value[path.id] : undefined;
      if (typeof id === "string" || typeof id === "number") {
        out.push(entityTag(path.entity, String(id)));
      }
      return;
    }
    const [step, ...next] = rest;
    if (Array.isArray(value)) {
      if (step === "[]") {
        value.forEach((item) => walk(item, path, next));
      }
    } else if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (step === "{}" || step === key) {
          walk(item, path, next);
        }
      }
    }
  };
  for (const path of paths ?? []) {
    walk(props, path, path.path);
  }
  return out;
}

/**
 * Resolves of missing entries in progress, by key: requests for one wait for it, rather than
 * resolving it again.
 */
export type Flights = Map<string, Promise<string>>;

/**
 * The innermost island resolver: from the cache when the island opts in and the composer has one,
 * otherwise by the island's own function. Failures are never cached; a cache that errors is
 * reported and bypassed. Requests for an entry already being resolved wait for it.
 */
export async function resolveCached<Ctx>(
  cache: Cache | undefined,
  flights: Flights,
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
  if (!cache || !opts || call.island.paged) {
    return call.island.resolve(call.rc);
  }
  const appKey = opts.key(call.rc);
  if (!appKey) {
    return call.island.resolve(call.rc);
  }
  const key = `island:${call.island.type}:${call.island.version}:${appKey}`;
  const failed = (error: unknown) =>
    report({
      kind: "cache",
      screen: call.screen,
      key: call.key,
      type: call.island.type,
      error,
    });

  try {
    const cached = await cache.get(key);
    if (cached !== undefined) {
      return JSON.parse(cached);
    }
  } catch (error) {
    failed(error);
  }

  const inFlight = flights.get(key);
  if (inFlight) {
    try {
      return JSON.parse(await inFlight);
    } catch {
      // The first request failed, perhaps only for its own reasons (its timeout): try ours.
      return call.island.resolve(call.rc);
    }
  }

  const resolving = (async () => JSON.stringify((await call.island.resolve(call.rc)) ?? {}))();
  flights.set(key, resolving);
  resolving.catch(() => {}).finally(() => flights.delete(key));
  const encoded = await resolving;
  const props: unknown = JSON.parse(encoded);
  try {
    const tags = [islandTag(call.island, appKey), ...heldTags(props, call.island.entities)];
    await cache.set(key, encoded, opts.ttlMs, tags);
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
  if (!idempotency || !req.idempotencyKey) {
    return perform(req, ctx);
  }
  const { store } = idempotency;
  const ttlMs = idempotency.ttlMs ?? 24 * 60 * 60 * 1000;
  const key = `action:${req.action}:${req.version}:${idempotency.scope(ctx)}:${req.idempotencyKey}`;
  const failed = (error: unknown) =>
    report({
      kind: "idempotency",
      action: req.action,
      version: req.version,
      error,
    });

  const deadline = Date.now() + (idempotency.waitMs ?? 10_000);
  for (;;) {
    let begun: { stored?: string; claimed: boolean };
    try {
      begun = await store.begin(key, ttlMs);
    } catch (error) {
      failed(error);
      return perform(req, ctx);
    }
    if (begun.stored !== undefined) {
      return { status: 200, body: JSON.parse(begun.stored) };
    }
    if (begun.claimed) {
      break;
    }
    if (Date.now() > deadline) {
      failed(new Error(`idempotency ${key}: still running`));
      return fail(500, "action_failed", "a call with this idempotency key is still running");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const res = await perform(req, ctx);
  try {
    if (res.status === 200) {
      await store.finish(key, JSON.stringify(res.body), ttlMs);
    } else {
      await store.release(key);
    }
  } catch (error) {
    failed(error);
  }
  return res;
}
