// Shared client conformance fixtures (spec §8.2).

import { test } from "node:test";
import assert from "node:assert/strict";
import { clientCases } from "@client-compose/conformance";
import type { ScreenResponse } from "@client-compose/protocol";
import { IslandRegistry, plan } from "../src/index.ts";

for (const c of clientCases().filter((c) => !c.typedOnly)) {
  test(c.name, () => {
    const registry = new IslandRegistry<string>();
    for (const [type, versions] of Object.entries(c.registered)) {
      for (const version of versions) {
        registry.register<{ v: number }>(type, version, (props) => `${type}@${version}:${props.v}`);
      }
    }
    assert.deepEqual(registry.capabilities(), c.expectCapabilities);

    const skipped: string[] = [];
    const planned = plan(registry, c.response as ScreenResponse, {
      onError: c.renderErrors ? (e) => `error:${e.key}:${e.error.code}` : undefined,
      onSkipped: (e) => skipped.push(e.key),
    });
    assert.deepEqual(planned.map((p) => p.render()), c.expectRendered);
    assert.deepEqual(skipped, c.expectSkipped);
  });
}
