// Adapters (spec/CAPABILITIES.md): interfaces the composer uses, implemented by your app. Each is
// optional: without one, its feature is off.

import type { ActionRequest } from "@client-compose/protocol";

import type { Failure } from "./plugins.ts";
import { fail, type PerformResult } from "./results.ts";

/**
 * Keeps data between requests (CMP-18), for every kind of data that opts in with `cacheMs`
 * (`defineData`). Implement it with whatever your app runs: Redis, Memcached, a Map. It's optional:
 * without one (`cache` in the composer's config), data is fetched on every request.
 *
 * Each entry is filed under tags: its own, and those its data's `tags` gives it (the entities it
 * holds, the lists it's on). After an action, the composer invalidates the tags of what it says
 * changed, so a change shows on the next request, from every composer sharing the cache. With Redis,
 * keep each tag as a set of keys:
 *
 *     const redisCache: Cache = {
 *       getMany: async (keys) => {
 *         const values = await redis.mGet(keys);
 *         return Object.fromEntries(keys.flatMap((k, i) => (values[i] == null ? [] : [[k, values[i]]])));
 *       },
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
  /** The values stored under any of `keys`, by key: keys with none are left out. */
  getMany(
    keys: readonly string[],
  ): Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
  /** Store `value` under `key` for `ttlMs`, filed under each of `tags`. */
  set(key: string, value: string, ttlMs: number, tags: readonly string[]): Promise<void> | void;
  /** Remove every value filed under any of `tags`. */
  invalidate(tags: readonly string[]): Promise<void> | void;
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
