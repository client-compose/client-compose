import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionResponse, ScreenResponse } from "@client-compose/protocol";

import { ActionFetchError, viaProxy } from "../src/index.ts";

const ok: ActionResponse = {
  protocol: 0,
  action: "follow",
  version: 1,
  status: "ok",
  result: { followers: 8 },
};
const home: ScreenResponse = {
  protocol: 0,
  screen: "home",
  islands: [],
};
const request = {
  protocol: 0 as const,
  action: "follow",
  version: 1,
  input: {},
  client: { platform: "web", appVersion: "1" },
};

test("performAction resolves with the server's response, and throws its failures", async () => {
  const transport = viaProxy({ performAction: async () => ({ ok: true, response: ok }) });
  assert.deepEqual(await transport.performAction(request), ok);

  const failing = viaProxy({
    performAction: async () => ({
      ok: false,
      status: 401,
      body: '{"error":{"code":"unauthenticated"}}',
    }),
  });
  await assert.rejects(failing.performAction(request), (error) => {
    assert.ok(error instanceof ActionFetchError);
    assert.equal(error.code, "unauthenticated");
    return true;
  });
});

test("fetch hands the screen request to loadScreen, and answers like the composer", async () => {
  const bodies: unknown[] = [];
  const transport = viaProxy({
    performAction: async () => ({ ok: true, response: ok }),
    loadScreen: async (body) => {
      bodies.push(body);
      return bodies.length === 1
        ? { ok: true, response: home }
        : {
            ok: false,
            status: 404,
            body: "gone",
          };
    },
  });
  const init = {
    method: "POST",
    body: JSON.stringify({
      protocol: 0,
      screen: "home",
      islands: {},
    }),
  };
  const found = await transport.fetch("ignored", init);
  assert.deepEqual(await found.json(), home);
  const missing = await transport.fetch("ignored", init);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "gone");
  assert.deepEqual(bodies[0], {
    protocol: 0,
    screen: "home",
    islands: {},
  });
});

test("fetch fails clearly without loadScreen", async () => {
  const transport = viaProxy({ performAction: async () => ({ ok: true, response: ok }) });
  await assert.rejects(transport.fetch("ignored", { body: "{}" }), /no loadScreen/);
});
