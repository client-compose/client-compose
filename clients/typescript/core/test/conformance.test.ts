// Shared client conformance fixtures (spec §8.2).

import assert from "node:assert/strict";
import { test } from "node:test";

import { clientCases } from "@client-compose/conformance";

import { buildRequest, fetchScreen, IslandRegistry, plan } from "../src/index.ts";

/** A fetch answering with the case's stream, a line at a time. */
const streaming = (lines: unknown[]) => async () =>
  new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), {
    headers: { "content-type": "application/jsonl" },
  });

for (const c of clientCases().filter((c) => !c.typedOnly)) {
  test(c.name, async () => {
    const registry = new IslandRegistry<string>();
    for (const [type, versions] of Object.entries(c.registered)) {
      for (const version of versions) {
        registry.register<{ v: number }>(type, version, (props) => `${type}@${version}:${props.v}`);
      }
    }
    assert.deepEqual(registry.capabilities(), c.expectCapabilities);

    const skipped: string[] = [];
    const request = buildRequest(registry, "s", { platform: "test", appVersion: "1" });
    const response = await fetchScreen("", request, {}, streaming(c.stream));
    const planned = plan(registry, response, {
      onError: c.renderErrors ? (e) => `error:${e.key}:${e.error.code}` : undefined,
      onSkipped: (e) => skipped.push(e.key),
    });
    assert.deepEqual(
      planned.map((p) => p.render()),
      c.expectRendered,
    );
    assert.deepEqual(skipped, c.expectSkipped);
  });
}

test("ScreenFetchError exposes the protocol error code", async () => {
  const { ScreenFetchError } = await import("../src/index.ts");
  assert.equal(
    new ScreenFetchError(404, '{"protocol":0,"error":{"code":"not_found"}}').code,
    "not_found",
  );
  assert.equal(new ScreenFetchError(502, "<html>bad gateway</html>").code, undefined);
});
