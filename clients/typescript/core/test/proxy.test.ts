import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor } from "@client-compose/protocol";

import {
  createComposerProxy,
  isProxiedActionRequest,
  isProxiedScreenRequest,
} from "../src/proxy.ts";
import {
  actionFailure,
  actionOk,
  createFakeGateway,
  island,
  islandResponse,
  screen,
  screenError,
  stringsResponse,
} from "../src/testing.ts";

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

test("loads islands' pages with the server's client context, checking the request", async () => {
  const List = { type: "list", version: 1 } as const;
  const gateway = createFakeGateway({
    islands: {
      "search/results": () => islandResponse("search", island("results", List, { n: 2 }, "c3")),
    },
  });
  const body = {
    protocol: 0,
    screen: "search",
    key: "results",
    version: 1,
    params: { q: "a" },
    cursor: "c2",
    client: { platform: "evil", appVersion: "0" },
  };
  const result = await proxyFor(gateway).loadIsland(body);
  assert.deepEqual(result.ok && result.response, {
    key: "results",
    type: "list",
    version: 1,
    status: "ok",
    props: { n: 2 },
    next: "c3",
  });
  const [sent] = gateway.islandRequests();
  assert.deepEqual([sent?.client, sent?.cursor, sent?.params], [server, "c2", { q: "a" }]);
  assert.equal(sent?.headers.authorization, "Bearer secret");

  for (const bad of [
    { ...body, version: "1" },
    { ...body, cursor: 2 },
    { ...body, key: undefined },
  ]) {
    const answered = await proxyFor(gateway).loadIsland(bad);
    assert.equal(!answered.ok && answered.status, 400);
  }
  assert.equal(gateway.islandRequests().length, 1);
});

test("loads the app strings in the server's client context's language", async () => {
  const gateway = createFakeGateway({
    strings: (request) => stringsResponse(request.client?.locale ?? "", { retry: "Réessayer" }),
  });
  const result = await proxyFor(gateway).loadStrings();
  assert.deepEqual(result.ok && result.response.strings, { retry: "Réessayer" });
  assert.equal(gateway.stringsRequests()[0]?.headers.authorization, "Bearer secret");

  const down = await proxyFor(
    createFakeGateway({ strings: () => screenError(404, "no_strings") }),
  ).loadStrings();
  assert.equal(!down.ok && down.status, 404);
});
