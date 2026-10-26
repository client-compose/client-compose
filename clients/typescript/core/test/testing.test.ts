import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor, IslandDescriptor } from "@client-compose/protocol";

import { callAction, fetchScreen } from "../src/index.ts";
import {
  actionError,
  actionFailure,
  actionOk,
  createFakeGateway,
  installFakeGateway,
  island,
  islandError,
  screen,
  screenError,
} from "../src/testing.ts";

const Header: IslandDescriptor<{ name: string }> = { type: "header", version: 2 };
type RenameError = { code: "taken"; details: { suggestion: string } };
const Rename: ActionDescriptor<{ name: string }, { id: string }, RenameError> = {
  action: "rename",
  version: 3,
  errors: ["taken"],
  input: { type: "object" },
};
const client = {
  platform: "web",
  appVersion: "1.0.0",
  locale: "en",
};

test("answers screen requests from handlers and records them", async () => {
  const gateway = createFakeGateway({
    screens: {
      profile: (req) =>
        screen("profile", [island("h", Header, { name: req.params.userId })], { title: "Ada" }),
    },
  });
  const res = await fetchScreen(
    "https://composer.test",
    {
      protocol: 0,
      screen: "profile",
      params: { userId: "u1" },
      client,
      islands: { header: [2] },
    },
    { headers: { Authorization: "Bearer t" } },
    gateway.fetch,
  );
  assert.deepEqual(res, {
    protocol: 0,
    screen: "profile",
    meta: { title: "Ada" },
    islands: [
      {
        key: "h",
        type: "header",
        version: 2,
        status: "ok",
        props: { name: "u1" },
      },
    ],
  });
  const [req] = gateway.screenRequests();
  assert.equal(req?.url, "https://composer.test/screens/profile");
  assert.equal(req?.method, "POST");
  assert.equal(req?.headers.authorization, "Bearer t");
  assert.deepEqual(req?.client, client);
  assert.deepEqual(req?.islands, { header: [2] });
  assert.deepEqual(gateway.actionRequests(), []);
});

test("answers action requests with typed outcomes", async () => {
  const gateway = createFakeGateway({
    actions: {
      rename: (req) =>
        req.input &&
        typeof req.input === "object" &&
        "name" in req.input &&
        req.input.name === "taken"
          ? actionError(Rename, { code: "taken", details: { suggestion: "taken2" } })
          : actionOk(Rename, { id: "t1" }, { navigate: { screen: "profile" } }),
    },
  });
  const ok = await callAction(
    "https://composer.test",
    Rename,
    { name: "New" },
    { client, fetch: gateway.fetch },
  );
  assert.deepEqual(ok, {
    protocol: 0,
    action: "rename",
    version: 3,
    status: "ok",
    result: { id: "t1" },
    effects: { navigate: { screen: "profile" } },
  });
  const taken = await callAction(
    "https://composer.test",
    Rename,
    { name: "taken" },
    { client, fetch: gateway.fetch },
  );
  assert.deepEqual(taken.status === "error" && taken.error, {
    code: "taken",
    details: { suggestion: "taken2" },
  });

  const requests = gateway.actionRequests();
  assert.deepEqual(
    requests.map((r) => [r.action, r.version, r.input]),
    [
      ["rename", 3, { name: "New" }],
      ["rename", 3, { name: "taken" }],
    ],
  );
  assert.equal(typeof requests[0]?.idempotencyKey, "string");
});

test("failures and errored islands have the protocol's shapes", () => {
  assert.deepEqual(screenError(404, "not_found"), {
    status: 404,
    body: { protocol: 0, error: { code: "not_found" } },
  });
  assert.deepEqual(actionFailure(401, "unauthenticated"), {
    status: 401,
    body: { protocol: 0, error: { code: "unauthenticated" } },
  });
  assert.deepEqual(islandError("h", Header, { code: "timeout", retryable: true }), {
    key: "h",
    type: "header",
    version: 2,
    status: "error",
    error: { code: "timeout", retryable: true },
  });
});

test("other requests go to `other` first; unhandled requests reject", async () => {
  const gateway = createFakeGateway({
    other: (req) =>
      req.url.startsWith("https://upload.test") ? { status: 201, body: { ok: true } } : undefined,
  });
  const form = new FormData();
  form.append("file", "x");
  const uploaded = await gateway.fetch("https://upload.test/1", { method: "POST", body: form });
  assert.equal(uploaded.status, 201);
  assert.ok(gateway.requests[0]?.body instanceof FormData);
  await assert.rejects(
    gateway.fetch("https://composer.test/screens/missing", { method: "POST", body: "{}" }),
    /no handler/,
  );
  assert.equal(gateway.requests.length, 2);
});

test("installFakeGateway answers the global fetch until restored", async () => {
  const original = globalThis.fetch;
  const gateway = installFakeGateway({ screens: { home: () => screen("home", []) } });
  try {
    const res = await fetchScreen("https://composer.test", {
      protocol: 0,
      screen: "home",
      client,
      islands: {},
    });
    assert.equal(res.screen, "home");
    assert.equal(gateway.screenRequests().length, 1);
  } finally {
    gateway.restore();
  }
  assert.equal(globalThis.fetch, original);
});
