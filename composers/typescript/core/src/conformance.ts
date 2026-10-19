// The test-only `__conformance` screen (spec §8.1). Never register this in production.

import type { IslandResolver, ScreenDefinition } from "./index.ts";

interface MockPlacement {
  key: string;
  type: string;
  versions: number[];
  outcome: "ok" | "error" | "timeout";
  required?: boolean;
  timeoutMs?: number;
}

export function conformanceScreen<Ctx = unknown>(): ScreenDefinition<Ctx> {
  return {
    id: "__conformance",
    layout: ({ params }) =>
      (JSON.parse(params.placements ?? "[]") as MockPlacement[]).map((p) => ({
        key: p.key,
        required: p.required,
        timeoutMs: p.timeoutMs,
        island: p.versions.map(
          (version): IslandResolver<Ctx> => ({
            type: p.type,
            version,
            resolve: ({ signal }) => {
              if (p.outcome === "error") throw new Error("mock failure");
              if (p.outcome === "timeout") {
                return new Promise((_, reject) => signal.addEventListener("abort", reject));
              }
              return { v: version };
            },
          }),
        ),
      })),
  };
}
