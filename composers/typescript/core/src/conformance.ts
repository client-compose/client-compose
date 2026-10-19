// The test-only `__conformance` screen (spec §8.1). Never register this in production.

import type { IslandResolver, ScreenDefinition } from "./index.ts";

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
    layout: ({ params }) => {
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
