// The test-only `__conformance` screen and `conformance` action (spec §8.1). Never register these
// in production.

import { defineAction, type ActionHandler } from "./actions.ts";
import {
  ConformanceV1,
  ConformanceV2,
  type ConformanceV1Error,
  type ConformanceV1Input,
} from "./conformance-actions.generated.ts";
import type { IslandResolver, ScreenDefinition } from "./index.ts";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "./loading.ts";

interface MockPlacement {
  key: string;
  type: string;
  versions: number[];
  outcome: "ok" | "error" | "timeout";
  required?: boolean;
  timeoutMs?: number;
  /** Load this key through the request-scoped `load` before resolving (spec §9). */
  load?: string;
  loadDelayMs?: number;
  /** Wait this long before loading, so the case controls which island starts a shared load. */
  startDelayMs?: number;
}

export function conformanceScreen<Ctx = unknown>(): ScreenDefinition<Ctx> {
  return {
    id: "__conformance",
    meta: ({ params }) => (params.meta ? JSON.parse(params.meta) : {}),
    layout: ({ params }) => {
      if (params.notFound === "true") throw new NotFoundError("no such thing");
      if (params.auth === "unauthenticated") throw new UnauthenticatedError();
      if (params.auth === "forbidden") throw new ForbiddenError();
      // How many times each load key's work actually ran during this request.
      const calls = new Map<string, number>();
      return (JSON.parse(params.placements ?? "[]") as MockPlacement[]).map((p) => ({
        key: p.key,
        required: p.required,
        timeoutMs: p.timeoutMs,
        island: p.versions.map(
          (version): IslandResolver<Ctx> => ({
            type: p.type,
            version,
            resolve: async ({ signal, load }) => {
              if (p.outcome === "error") throw new Error("mock failure");
              if (p.outcome === "timeout") {
                return new Promise((_, reject) => signal.addEventListener("abort", reject));
              }
              if (p.load === undefined) return { v: version };
              const key = p.load;
              if (p.startDelayMs) await new Promise((resolve) => setTimeout(resolve, p.startDelayMs));
              await load(key, (shared) => {
                calls.set(key, (calls.get(key) ?? 0) + 1);
                return new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(resolve, p.loadDelayMs ?? 0);
                  shared.addEventListener("abort", () => {
                    clearTimeout(timer);
                    reject(new Error("shared load cancelled"));
                  });
                });
              });
              return { v: version, calls: calls.get(key) };
            },
          }),
        ),
      }));
    },
  };
}

export function conformanceActions<Ctx = unknown>(): ActionHandler<Ctx>[] {
  // v2 is v1 with a different version number.
  const perform = (version: number) => (input: ConformanceV1Input, ac: { idempotencyKey?: string }) => {
    const error = (e: ConformanceV1Error) => ({ error: e });
    switch (input.outcome) {
      case "rejected":
        return error({ code: "rejected", details: { echo: input.echo } });
      case "unavailable":
        return error({ code: "unavailable" });
      case "undeclared":
        return { error: { code: "undeclared" } as unknown as ConformanceV1Error };
      case "fail":
        throw new Error("mock failure");
      case "not_found":
        throw new NotFoundError();
      case "unauthenticated":
        throw new UnauthenticatedError();
      case "forbidden":
        throw new ForbiddenError();
    }
    return {
      result: { echo: input.echo, version, ...(ac.idempotencyKey !== undefined && { idempotencyKey: ac.idempotencyKey }) },
      effects: input.effects,
    };
  };
  return [defineAction(ConformanceV1, perform(1)), defineAction(ConformanceV2, perform(2))];
}
