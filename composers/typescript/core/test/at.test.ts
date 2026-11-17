// When a screen was read and when an action finished (spec §4, §5.3): what clients compare to catch a
// screen up with an action it was rendered before.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ScreenRequest } from "@client-compose/protocol";

import { ConformanceV1 } from "../src/conformance-actions.generated.ts";
import { action, collect, createComposer, type Island, screen } from "../src/index.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a screen's at is when the composer started answering it", async () => {
  const slow: Island<null, unknown> = {
    type: "x",
    version: 1,
    resolve: async () => {
      await wait(50);

      return {};
    },
  };
  const s = screen<null>("s", {
    layout: () => [
      {
        key: "a",
        required: true,
        versions: [slow],
      },
    ],
  });
  const request: ScreenRequest = {
    protocol: 0,
    screen: "s",
    client: { platform: "test", appVersion: "1" },
    islands: { x: [1] },
  };
  const before = Date.now();

  const result = await createComposer<null>({ screens: [s] }).compose(request, null);

  assert.ok(result.status === 200);
  const { at } = await collect(result.body);
  // Before its island was read, which took 50ms.
  assert.ok(at !== undefined && at >= before && at < before + 40, `at ${at}, started ${before}`);
});

const request = {
  protocol: 0 as const,
  action: "conformance",
  version: 1,
  input: { outcome: "ok", echo: "hi" },
  client: { platform: "web", appVersion: "1" },
  islands: {},
};

test("an action's effects say when it finished", async () => {
  const composer = createComposer<undefined>({
    actions: [
      action(ConformanceV1, async (input) => {
        await wait(20);

        return {
          result: { echo: input.echo, version: 1 },
          effects: { invalidate: [{ screen: "s" }] },
        };
      }),
    ],
  });
  const before = Date.now();

  const res = await composer.perform(request, undefined);

  assert.ok(res.status === 200 && "status" in res.body && res.body.status === "ok");
  const at = res.body.effects?.at;
  assert.ok(
    at !== undefined && at >= before + 20 && at <= Date.now(),
    `at ${at}, started ${before}`,
  );
});

test("an action with no effects has no at", async () => {
  const composer = createComposer<undefined>({
    actions: [action(ConformanceV1, (input) => ({ result: { echo: input.echo, version: 1 } }))],
  });

  const res = await composer.perform(request, undefined);

  assert.ok(res.status === 200 && "status" in res.body && res.body.status === "ok");
  assert.equal(res.body.effects, undefined);
});
