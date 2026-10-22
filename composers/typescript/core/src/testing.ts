// Test a composer the way apps use it, in-process (CMP-13). Requests go through `composer.handle`,
// so your context function, requirements and plugins all run, and results come back typed.
//
//     const app = testComposer(composer);
//     const profile = await app.screen("profile", { userId: "u1" }, { headers: { authorization: "Bearer t" } });
//     const header = profile.props(ProfileHeaderV2, "header");
//
//     const followed = await app.perform(FollowUserV1, { userId: "u1" });
//     assert.equal(followed.result?.followers, 8);

import {
  type ActionDescriptor,
  type ActionEffects,
  type Capabilities,
  type ClientContext,
  type DeclaredError,
  type IslandDescriptor,
  type IslandEntry,
  PROTOCOL_VERSION,
  type ScreenErrorResponse,
  type ScreenResponse,
} from "@client-compose/protocol";

import type { Cache, IdempotencyStore } from "./adapters.ts";
import type { Composer } from "./composer.ts";

export interface TestComposerOptions<Req> {
  /**
   * The islands the app declares it can render, replacing the default: every island the composer's
   * declared screens place. Use it to test an older app, or screens with a layout function.
   */
  declare?: IslandDescriptor<unknown>[];
  /** The client context sent with every request. Default: platform "test", app version "1". */
  client?: ClientContext;
  /**
   * Builds your server's request type, for composers whose `context` takes something other than a
   * fetch `Request` (Express, Fastify, node:http). Default: a fetch `Request`.
   */
  request?: (init: { url: string; headers: Record<string, string>; body: string }) => Req;
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

export interface TestScreen {
  /** The HTTP status. */
  status: number;
  /** The screen, when status is 200. */
  response?: ScreenResponse;
  /** The protocol error code otherwise, e.g. "not_found". */
  error?: string;
  /** The screen's island keys, in order. */
  keys(): string[];
  /** The island with this key, if the screen has it. */
  island(key: string): IslandEntry | undefined;
  /** An island's props, typed by its descriptor. Throws if the island is missing or errored. */
  props<P>(descriptor: IslandDescriptor<P>, key: string): P;
}

export interface TestOutcome<R, E extends DeclaredError> {
  /** "ok" or "error" when the action ran (HTTP 200), undefined otherwise. */
  status?: "ok" | "error";
  /** The HTTP status. */
  httpStatus: number;
  result?: R;
  effects?: ActionEffects;
  /** The declared error, when status is "error". */
  error?: E;
  /** The protocol error code (e.g. "unauthenticated", "invalid_input") when the action didn't run. */
  failure?: string;
}

export interface TestComposer {
  screen(
    id: string,
    params?: Record<string, string>,
    options?: RequestOptions,
  ): Promise<TestScreen>;
  perform<I, R, E extends DeclaredError>(
    descriptor: ActionDescriptor<I, R, E>,
    input: I,
    options?: RequestOptions & { idempotencyKey?: string },
  ): Promise<TestOutcome<R, E>>;
}

const base = "https://composer.test";

export function testComposer<Ctx, Req = Request>(
  composer: Composer<Ctx, Req>,
  options: TestComposerOptions<Req> = {},
): TestComposer {
  const islands: Capabilities = options.declare ? declared(options.declare) : composer.islands();
  const client = options.client ?? { platform: "test", appVersion: "1" };
  const toRequest =
    options.request ??
    ((init: { url: string; headers: Record<string, string>; body: string }) =>
      new Request(init.url, { method: "POST", headers: init.headers, body: init.body }) as Req);

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    const raw = JSON.stringify(body);
    const allHeaders = { "content-type": "application/json", ...headers };
    const res = await composer.handle(
      path,
      raw,
      toRequest({ url: base + path, headers: allHeaders, body: raw }),
    );
    if (!res) throw new Error(`testComposer: ${path} isn't a composer route`);
    return res;
  }

  return {
    async screen(id, params = {}, requestOptions = {}) {
      const res = await post(
        `/screens/${encodeURIComponent(id)}`,
        { protocol: PROTOCOL_VERSION, screen: id, params, client, islands },
        requestOptions.headers,
      );
      const response = res.status === 200 ? (res.body as ScreenResponse) : undefined;
      const entries = response?.islands ?? [];
      return {
        status: res.status,
        response,
        error: response ? undefined : (res.body as ScreenErrorResponse).error.code,
        keys: () => entries.map((e) => e.key),
        island: (key) => entries.find((e) => e.key === key),
        props<P>(descriptor: IslandDescriptor<P>, key: string): P {
          const entry = entries.find((e) => e.key === key);
          if (!entry) {
            throw new Error(
              `testComposer: screen ${id} has no island "${key}" (it has ${entries.map((e) => e.key).join(", ") || "none"})`,
            );
          }
          if (entry.status !== "ok")
            throw new Error(
              `testComposer: island "${key}" is ${entry.status}: ${JSON.stringify(entry)}`,
            );
          if (entry.type !== descriptor.type || entry.version !== descriptor.version) {
            throw new Error(
              `testComposer: island "${key}" is ${entry.type} v${entry.version}, not ${descriptor.type} v${descriptor.version}`,
            );
          }
          return entry.props as P;
        },
      };
    },

    async perform(descriptor, input, requestOptions = {}) {
      const res = await post(
        `/actions/${encodeURIComponent(descriptor.action)}`,
        {
          protocol: PROTOCOL_VERSION,
          action: descriptor.action,
          version: descriptor.version,
          input,
          client,
          ...(requestOptions.idempotencyKey !== undefined && {
            idempotencyKey: requestOptions.idempotencyKey,
          }),
        },
        requestOptions.headers,
      );
      if (res.status !== 200)
        return { httpStatus: res.status, failure: (res.body as ScreenErrorResponse).error.code };
      const body = res.body as {
        status: "ok" | "error";
        result?: never;
        effects?: ActionEffects;
        error?: never;
      };
      return {
        httpStatus: 200,
        status: body.status,
        result: body.result,
        effects: body.effects,
        error: body.error,
      };
    },
  };
}

function declared(descriptors: IslandDescriptor<unknown>[]): Capabilities {
  const out: Capabilities = {};
  for (const d of descriptors) (out[d.type] ??= []).push(d.version);
  for (const versions of Object.values(out)) versions.sort((a, b) => a - b);
  return out;
}

/** An in-memory `Cache` for tests, with the keys it holds. Entries expire after their TTL. */
export function memoryCache(): Cache & { keys(): string[] } {
  const entries = new Map<string, { value: string; expires: number }>();
  const live = (key: string) => {
    const entry = entries.get(key);
    return entry && entry.expires > Date.now() ? entry : undefined;
  };
  return {
    get: (key) => live(key)?.value,
    set: (key, value, ttlMs) => void entries.set(key, { value, expires: Date.now() + ttlMs }),
    keys: () => [...entries.keys()].filter((key) => live(key)),
  };
}

/** An in-memory `IdempotencyStore` for tests. */
export function memoryIdempotencyStore(): IdempotencyStore {
  const entries = new Map<string, { outcome?: string; expires: number }>();
  return {
    begin(key, ttlMs) {
      const entry = entries.get(key);
      if (entry && entry.expires > Date.now()) return { stored: entry.outcome, claimed: false };
      entries.set(key, { expires: Date.now() + ttlMs });
      return { claimed: true };
    },
    finish: (key, outcome, ttlMs) =>
      void entries.set(key, { outcome, expires: Date.now() + ttlMs }),
    release: (key) => void entries.delete(key),
  };
}
