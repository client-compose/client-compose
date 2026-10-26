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

export class RequestScope {
  readonly signal: AbortSignal;
  private readonly memo = new Map<string, Promise<unknown>>();
  private readonly batches = new Map<BatchLoader<unknown, unknown>, BatchState<unknown, unknown>>();

  constructor(signal: AbortSignal) {
    this.signal = signal;
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
        .then(() => fetch(keys, scope.signal))
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
