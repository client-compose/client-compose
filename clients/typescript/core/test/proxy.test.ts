import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor } from "@client-compose/protocol";

import {
  createComposerProxy,
  isProxiedActionRequest,
  isProxiedScreenRequest,
} from "../src/proxy.ts";
import { actionFailure, actionOk, createFakeGateway, screen, screenError } from "../src/testing.ts";

const SignIn: ActionDescriptor<{ email: string }, { token: string }, never> = {
  action: "sign-in",
  version: 1,
  errors: [],
  input: { type: "object" },
};
const server = {
  platform: "web",
  appVersion: "2.0.0",
  locale: "fr",
};
const actionBody = {
  protocol: 0,
  action: "sign-in",
  version: 1,
  input: { email: "ada@example.com" },
};
const screenBody = {
  protocol: 0,
  screen: "home",
  islands: { feed: [1] },
};

function proxyFor(gateway: ReturnType<typeof createFakeGateway>) {
  return createComposerProxy({
    baseUrl: "https://composer.test",
    client: () => server,
    headers: async () => ({ Authorization: "Bearer secret" }),
    requestInit: { cache: "no-store" },
    fetch: gateway.fetch,
  });
}

test("performs actions with the server's client context and headers", async () => {
  const gateway = createFakeGateway({
    actions: { "sign-in": () => actionOk(SignIn, { token: "t" }) },
  });
  const result = await proxyFor(gateway).performAction({
    ...actionBody,
    client: { platform: "evil", appVersion: "0" },
  });
  assert.equal(result.ok && result.response.status, "ok");
  const [sent] = gateway.actionRequests();
  assert.deepEqual(sent?.client, server);
  assert.equal(sent?.headers.authorization, "Bearer secret");
  assert.deepEqual(sent?.input, { email: "ada@example.com" });
});

test("lets the server see and change an action's response", async () => {
  const gateway = createFakeGateway({
    actions: { "sign-in": () => actionOk(SignIn, { token: "t" }) },
  });
  const seen: string[] = [];
  const proxy = createComposerProxy({
    baseUrl: "https://composer.test",
    client: () => server,
    fetch: gateway.fetch,
    onActionResponse: (request, response) => {
      seen.push(request.action);
      return { ...response, result: { token: "" } };
    },
  });
  const result = await proxy.performAction(actionBody);
  assert.deepEqual(seen, ["sign-in"]);
  assert.deepEqual(result.ok && result.response.status === "ok" && result.response.result, {
    token: "",
  });
});

test("returns the composer's failures as data", async () => {
  const gateway = createFakeGateway({
    actions: { "sign-in": () => actionFailure(401, "unauthenticated") },
    screens: { home: () => screenError(404, "not_found") },
  });
  const action = await proxyFor(gateway).performAction(actionBody);
  assert.equal(!action.ok && action.status, 401);
  assert.match(!action.ok ? action.body : "", /unauthenticated/);
  const loaded = await proxyFor(gateway).loadScreen(screenBody);
  assert.equal(!loaded.ok && loaded.status, 404);
});

test("loads screens with the server's client context", async () => {
  const gateway = createFakeGateway({ screens: { home: () => screen("home", []) } });
  const result = await proxyFor(gateway).loadScreen(screenBody);
  assert.equal(result.ok && result.response.screen, "home");
  assert.deepEqual(gateway.screenRequests()[0]?.client, server);
  assert.deepEqual(gateway.screenRequests()[0]?.islands, { feed: [1] });
});

test("answers malformed requests with bad_request, without sending them", async () => {
  const gateway = createFakeGateway();
  const proxy = proxyFor(gateway);
  for (const body of [
    undefined,
    "x",
    { ...actionBody, protocol: 1 },
    { ...actionBody, version: "1" },
  ]) {
    const result = await proxy.performAction(body);
    assert.deepEqual(result, {
      ok: false,
      status: 400,
      body: '{"protocol":0,"error":{"code":"bad_request"}}',
    });
  }
  const screen = await proxy.loadScreen({ ...screenBody, params: { id: 1 } });
  assert.equal(!screen.ok && screen.status, 400);
  assert.equal(gateway.requests.length, 0);
});

test("guards accept requests with or without optional fields", () => {
  assert.ok(isProxiedActionRequest({ ...actionBody, idempotencyKey: "k" }));
  assert.ok(!isProxiedActionRequest({ ...actionBody, idempotencyKey: 1 }));
  assert.ok(
    !isProxiedActionRequest({
      protocol: 0,
      action: "a",
      version: 1,
    }),
  );
  assert.ok(isProxiedScreenRequest({ ...screenBody, params: { id: "1" } }));
  assert.ok(!isProxiedScreenRequest({ ...screenBody, islands: { feed: ["1"] } }));
});
