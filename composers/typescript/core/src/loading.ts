import type { Cache } from "./adapters.ts";

// Request-scoped data loading: islands (and the layout) that need the same data within one screen
// request share one call, and batch loaders combine their keys into one call.
//
// Shared work runs under the *request's* signal, never one island's: if an island times out, the
// work it shares with other islands keeps going for them. The composer aborts the request signal
// once the response is ready, cancelling anything still running.

/** Where the composer keeps the request scope on contexts it passes in. Not needed by app code. */
export const scopeSymbol: unique symbol = Symbol("client-compose.requestScope");

/** Something carrying a request scope: the ResolveContext / layout context the composer passes in. */
export interface LoadContext {
  readonly [scopeSymbol]: RequestScope;
}

/**
 * What data needs to be kept between requests (CMP-18): the composer's cache, whether this request
 * reads it (actions read fresh), who's asking, the fetches in flight across every request, and
 * where to report a cache that errors.
 */
export interface ScopeCache {
  cache: Cache;
  reads: boolean;
  viewer: (() => string | undefined) | undefined;
  flights: Flights;
  report: (error: unknown) => void;
}

export class RequestScope {
  readonly signal: AbortSignal;
  readonly kept: ScopeCache | undefined;
  private readonly memo = new Map<string, Promise<unknown>>();
  private readonly batches = new Map<BatchLoader<unknown, unknown>, BatchState<unknown, unknown>>();

  constructor(signal: AbortSignal, kept?: ScopeCache) {
    this.signal = signal;
    this.kept = kept;
  }

  /** Run `fn` once per key for this request; every caller gets the same result (or error). */
  load<T>(key: string, fn: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
    // One map holds every key's promise, whatever its type: a key always comes with the same `fn`.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    let promise = this.memo.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = new Promise<T>((resolve) => resolve(fn(this.signal)));
      promise.catch(() => {}); // a caller that timed out may no longer be listening
      this.memo.set(key, promise);
    }
    return promise;
  }

  // One map holds every batch loader's state, whatever its key and value types: each loader only
  // ever reads its own, so the types line up, but TypeScript can't see it.
  /* eslint-disable @typescript-eslint/consistent-type-assertions */
  batchState<K, V>(loader: BatchLoader<K, V>): BatchState<K, V> {
    let state = this.batches.get(loader as BatchLoader<unknown, unknown>) as
      BatchState<K, V> | undefined;
    if (!state) {
      state = {
        memo: new Map(),
        pending: [],
        timer: undefined,
      };
      this.batches.set(
        loader as BatchLoader<unknown, unknown>,
        state as BatchState<unknown, unknown>,
      );
    }
    return state;
  }
  /* eslint-enable @typescript-eslint/consistent-type-assertions */
}

export function attachScope<T extends object>(target: T, scope: RequestScope): T & LoadContext {
  // defineProperty returns its target typed as it was, not with the property it just defined.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return Object.defineProperty(target, scopeSymbol, { value: scope, enumerable: false }) as T &
    LoadContext;
}

function scopeOf(context: LoadContext): RequestScope {
  const scope = context[scopeSymbol];
  if (!scope) {
    throw new Error("Batch loaders need the context passed to a layout or resolver");
  }
  return scope;
}

/**
 * Something a screen's params refer to doesn't exist. Thrown from a layout (or a load it awaits),
 * the composer responds 404 `not_found` (spec §4.3).
 */
export class NotFoundError extends Error {}

/**
 * There's no signed-in user, and the screen or action needs one. Thrown from a layout or action,
 * the composer responds 401 `unauthenticated`.
 */
export class UnauthenticatedError extends Error {}

/** The user may not see the screen or perform the action: the composer responds 403 `forbidden`. */
export class ForbiddenError extends Error {}

/**
 * A paged island can't read the cursor it was given: one it didn't make, or one that's no longer
 * good. The composer responds 400 `invalid_cursor` (spec §4.5).
 */
export class InvalidCursorError extends Error {}

/** A batch loader returned no value for a key. Thrown from a layout, it makes the screen 404. */
export class LoadNotFoundError extends NotFoundError {
  readonly key: unknown;

  constructor(key: unknown) {
    super(`No value loaded for key ${JSON.stringify(key)}`);
    this.key = key;
  }
}

export interface BatchLoaderOptions<K> {
  /** Most keys per call; larger batches are split. Default: unlimited. */
  maxBatchSize?: number;
  /** How long to collect keys before calling, in ms. Default 0 (the next macrotask). */
  windowMs?: number;
  /** Turns a key into a string for de-duplication. Default: `String(key)` (use this for object keys). */
  cacheKey?: (key: K) => string;
}

export interface BatchLoader<K, V> {
  /** Load one key, batched with every other key requested in the same request and window. */
  load(context: LoadContext, key: K): Promise<V>;
  /**
   * Load several keys at once, batched as `load` is, keyed by their `cacheKey`. Rejects if any key
   * fails, missing keys included.
   */
  loadMany(context: LoadContext, keys: readonly K[]): Promise<Map<K, V>>;
}

interface Pending<K, V> {
  key: K;
  resolve: (value: V) => void;
  reject: (error: unknown) => void;
}

interface BatchState<K, V> {
  memo: Map<string, Promise<V>>;
  pending: Pending<K, V>[];
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Define a batch loader, once, at module level. Each request gets its own batches and results.
 *
 * `fetch` receives the de-duplicated keys and returns either a Map keyed by the same key values, or
 * an array aligned with `keys` (`undefined` for a missing key). Missing keys reject with
 * `LoadNotFoundError`.
 *
 *     const userById = defineBatchLoader((ids: string[], signal) => users.getMany(ids, { signal }));
 *     // in a resolver:
 *     const user = await userById.load(rc, params.userId);
 */
export function defineBatchLoader<K, V>(
  fetch: (
    keys: K[],
    signal: AbortSignal,
    scope: RequestScope,
  ) => Promise<ReadonlyMap<K, V> | ReadonlyArray<V | undefined>>,
  options: BatchLoaderOptions<K> = {},
): BatchLoader<K, V> {
  const cacheKey = options.cacheKey ?? ((key: K) => String(key));
  const maxBatchSize = options.maxBatchSize ?? Infinity;

  const loader: BatchLoader<K, V> = {
    load(context, key) {
      const scope = scopeOf(context);
      const state = scope.batchState(loader);
      const id = cacheKey(key);
      const existing = state.memo.get(id);
      if (existing) {
        return existing;
      }

      const promise = new Promise<V>((resolve, reject) =>
        state.pending.push({
          key,
          resolve,
          reject,
        }),
      );
      promise.catch(() => {});
      state.memo.set(id, promise);
      if (state.pending.length >= maxBatchSize) {
        flush(scope, state);
      } else if (state.timer === undefined) {
        state.timer = setTimeout(() => flush(scope, state), options.windowMs ?? 0);
      }
      return promise;
    },
    async loadMany(context, keys) {
      const values = await Promise.all(keys.map((key) => loader.load(context, key)));
      return new Map(keys.map((key, i) => [key, values[i]]));
    },
  };

  function flush(scope: RequestScope, state: BatchState<K, V>): void {
    clearTimeout(state.timer);
    state.timer = undefined;
    while (state.pending.length) {
      const batch = state.pending.splice(0, maxBatchSize);
      const keys = batch.map((p) => p.key);
      Promise.resolve()
        .then(() => fetch(keys, scope.signal, scope))
        .then(
          (result) =>
            batch.forEach((p, i) => {
              const value = isMap(result) ? result.get(p.key) : result[i];
              if (value === undefined) {
                p.reject(new LoadNotFoundError(p.key));
              } else {
                p.resolve(value);
              }
            }),
          (error) => batch.forEach((p) => p.reject(error)),
        );
    }
  }

  return loader;
}

const isMap = <K, V>(
  value: ReadonlyMap<K, V> | ReadonlyArray<V | undefined>,
): value is ReadonlyMap<K, V> => value instanceof Map;

/**
 * Fetches of missing entries in progress, by cache key, across every request a composer serves:
 * requests for one wait for it, rather than fetching it again.
 */
export type Flights = Map<string, Promise<string | undefined>>;

export interface DataOptions<K, V> extends BatchLoaderOptions<K> {
  /**
   * Keep each value this long across requests, when the composer has a `cache`: the longest it may
   * be out of date if it changes without an action saying so. Without it, it's fetched on every
   * request, batched within each.
   */
  cacheMs?: number;
  /**
   * Keep each viewer's values apart, by the composer's `viewer`: for data that differs by who's
   * asking (what they've saved, whom they follow). It's never shared between viewers, and never
   * cached by a composer that can't say who's asking.
   */
  perViewer?: boolean;
  /**
   * More tags to file each value under than its own, for actions to clear it by: `entityTag` for
   * each entity it holds, and tags of your own (a list's, so actions that add to it can clear it).
   */
  tags?: (key: K, value: V) => readonly string[];
}

/** One kind of data: loaded by key, batched within a request, and kept between requests if it opts in. */
export interface Data<K, V> {
  /** Load one key: from this request's loads, then the cache, then `fetch`. */
  load(context: Partial<LoadContext>, key: K): Promise<V>;
  /** Load several keys at once, as `load` does. Rejects if any key fails, missing keys included. */
  loadMany(context: Partial<LoadContext>, keys: readonly K[]): Promise<Map<K, V>>;
  /**
   * The tag of key's entry, for an action's `stale`: the value changed. For data kept per viewer,
   * pass who's asking.
   */
  tag(key: K, viewer?: string): string;
}

/** The tag of every value holding one entity: an action changing the entity clears them. */
export function entityTag(entity: string, id: string): string {
  return `tag:entity:${entity}:${id}`;
}

/**
 * Declare a kind of data your islands show (CMP-18), once, at module level: users, articles, whether
 * the viewer follows someone. How long something can be cached is a property of the data, not of
 * the islands that show it.
 *
 *     const users = defineData("user", (ids: string[], signal) => store.users(ids, { signal }), {
 *       cacheMs: 600_000,
 *       tags: (id) => [entityTag("user", id)], // cleared when an action changes the user
 *     });
 *     const following = defineData("following", store.following, { cacheMs: 3_600_000, perViewer: true });
 *     // in any resolver:
 *     const author = await users.load(rc, article.authorId);
 *
 * Every entry is filed under its own tag (`tag`) and those `tags` gives it. An action clears them by
 * returning entity changes (`changed`, `deleted` clear `entityTag(entity, id)`) or naming them in
 * `stale`. Actions read fresh data: loads outside a screen's or island's request aren't cached.
 * Failures and missing keys are never cached. A cache that errors is reported and bypassed. When
 * several requests miss the same entry at once, one fetches it and the others wait for it.
 */
export function defineData<K, V>(
  name: string,
  fetch: (
    keys: K[],
    signal: AbortSignal,
  ) => Promise<ReadonlyMap<K, V> | ReadonlyArray<V | undefined>>,
  options: DataOptions<K, V> = {},
): Data<K, V> {
  if (!name || /[: ]/.test(name)) {
    throw new Error(`Data name "${name}" must be set, without spaces or colons`);
  }
  const keyOf = options.cacheKey ?? ((key: K) => String(key));
  const entry = (key: K, viewer: string | undefined) =>
    options.perViewer ? `${name}:viewer:${viewer ?? ""}:${keyOf(key)}` : `${name}:${keyOf(key)}`;

  const asMap = (keys: K[], result: ReadonlyMap<K, V> | ReadonlyArray<V | undefined>) =>
    isMap(result)
      ? new Map(result)
      : new Map(keys.flatMap((k, i) => (result[i] === undefined ? [] : [[k, result[i]] as const])));

  async function cached(keys: K[], signal: AbortSignal, scope: RequestScope): Promise<Map<K, V>> {
    const kept = scope.kept;
    if (
      !options.cacheMs ||
      !kept ||
      !kept.reads ||
      (options.perViewer && kept.viewer === undefined)
    ) {
      // Not cached: it doesn't opt in, there's no cache, an action is reading it fresh, or it's
      // kept per viewer and the composer can't say who's asking, so it's never shared.
      return asMap(keys, await fetch(keys, signal));
    }
    const viewer = options.perViewer ? kept.viewer?.() : undefined;
    const cacheKeys = new Map(keys.map((k) => [k, `data:${entry(k, viewer)}`]));
    const out = new Map<K, V>();
    let found = new Map<string, string>();
    try {
      found = new Map(Object.entries(await kept.cache.getMany([...cacheKeys.values()])));
    } catch (error) {
      kept.report(error);
    }
    const missing: K[] = [];
    for (const k of keys) {
      const raw = found.get(cacheKeys.get(k) ?? "");
      if (raw !== undefined) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        out.set(k, JSON.parse(raw) as V);
      } else {
        missing.push(k);
      }
    }
    if (missing.length === 0) {
      return out;
    }

    // One fetch per missing entry across every request: lead the entries no one is fetching,
    // wait for the rest.
    const lead = missing.filter((k) => !kept.flights.has(cacheKeys.get(k) ?? ""));
    const waiting = missing.filter((k) => !lead.includes(k));
    const waits = new Map(waiting.map((k) => [k, kept.flights.get(cacheKeys.get(k) ?? "")]));
    if (lead.length) {
      const fetching = (async () => asMap(lead, await fetch(lead, signal)))();
      for (const k of lead) {
        const key = cacheKeys.get(k) ?? "";
        const one = fetching.then((values) => {
          const v = values.get(k);
          return v === undefined ? undefined : JSON.stringify(v);
        });
        one.catch(() => {});
        kept.flights.set(key, one);
        void one.catch(() => {}).finally(() => kept.flights.delete(key));
      }
      const values = await fetching;
      for (const [k, v] of values) {
        out.set(k, v);
        const key = cacheKeys.get(k) ?? "";
        try {
          await kept.cache.set(key, JSON.stringify(v), options.cacheMs, [
            `tag:${key}`,
            ...(options.tags?.(k, v) ?? []),
          ]);
        } catch (error) {
          kept.report(error);
        }
      }
    }
    const retry: K[] = [];
    for (const [k, wait] of waits) {
      try {
        const raw = await wait;
        if (raw !== undefined) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          out.set(k, JSON.parse(raw) as V);
        }
      } catch {
        // The first request failed, perhaps only for its own reasons (its timeout): try ours.
        retry.push(k);
      }
    }
    if (retry.length) {
      for (const [k, v] of asMap(retry, await fetch(retry, signal))) {
        out.set(k, v);
      }
    }
    return out;
  }

  const loader = defineBatchLoader<K, V>(cached, options);
  const fresh = async (keys: readonly K[]) =>
    asMap([...keys], await fetch([...keys], new AbortController().signal));

  return {
    async load(context, key) {
      if (!context[scopeSymbol]) {
        const value = (await fresh([key])).get(key);
        if (value === undefined) {
          throw new LoadNotFoundError(key);
        }
        return value;
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return loader.load(context as LoadContext, key);
    },
    async loadMany(context, keys) {
      if (!context[scopeSymbol]) {
        const values = await fresh(keys);
        for (const key of keys) {
          if (!values.has(key)) {
            throw new LoadNotFoundError(key);
          }
        }
        return values;
      }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return loader.loadMany(context as LoadContext, keys);
    },
    tag: (key, viewer) => `tag:data:${entry(key, viewer)}`,
  };
}
