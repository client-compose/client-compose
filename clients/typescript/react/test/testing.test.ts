import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActionDescriptor, IslandDescriptor, ScreenRef } from "@client-compose/protocol";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  type ActionResult,
  type ActionState,
  ClientComposeProvider,
  ComposedScreen,
  declaredError,
  isUnexpected,
  ReactIslandRegistry,
  useAction,
  usePages,
} from "../src/index.ts";
import {
  actionError,
  actionOk,
  createTestConfig,
  island,
  pagedIsland,
  screen,
} from "../src/testing.ts";

const Name: IslandDescriptor<{ name: string }> = { type: "name", version: 1 };
const registry = new ReactIslandRegistry().registerComponent(Name, ({ name }) =>
  createElement("b", null, name),
);

type FollowError = { code: "blocked" } | { code: "limit"; details: { max: number } };
const Follow: ActionDescriptor<{ userId: string }, { followers: number }, FollowError> = {
  action: "follow",
  version: 1,
  errors: ["blocked", "limit"],
  input: { type: "object" },
};

test("createTestConfig renders screens from the fake composer and records effects", async () => {
  const navigatedTo: ScreenRef[] = [];
  const { config, gateway, navigations, invalidations } = createTestConfig({
    registry,
    client: { platform: "ios", appVersion: "test" },
    onNavigate: (ref) => navigatedTo.push(ref),
    handlers: {
      screens: { profile: () => screen("profile", [island("n", Name, { name: "Ada" })]) },
      actions: {
        follow: () =>
          actionOk(
            Follow,
            { followers: 8 },
            { navigate: { screen: "feed" }, invalidate: [{ screen: "profile" }] },
          ),
      },
    },
  });
  let follow!: ActionState<{ userId: string }, { followers: number }, FollowError>;
  function Harness(): ReactNode {
    follow = useAction(Follow);
    return createElement(ComposedScreen, { screen: "profile" });
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(createElement(ClientComposeProvider, { config }, createElement(Harness))),
  );
  assert.equal(container.innerHTML, "<b>Ada</b>");

  await act(async () => {
    await follow.run({ userId: "u1" });
  });
  assert.deepEqual(navigations, [{ screen: "feed" }]);
  assert.deepEqual(navigatedTo, [{ screen: "feed" }], "the app's own onNavigate still runs");
  assert.deepEqual(invalidations, [[{ screen: "profile" }]]);
  assert.deepEqual(
    gateway.requests.map((r) => r.url),
    [
      "http://composer.test/screens/profile",
      "http://composer.test/actions/follow",
      "http://composer.test/screens/profile",
    ],
  );
  assert.equal(gateway.actionRequests()[0]?.client?.platform, "ios");
  await act(async () => root.unmount());
});

test("declaredError and isUnexpected read how an action call ended", () => {
  const ok: ActionResult<unknown, FollowError> = {
    protocol: 0,
    action: "follow",
    version: 1,
    status: "ok",
    result: {},
  };
  const blocked: ActionResult<unknown, FollowError> = {
    ...ok,
    status: "error",
    error: { code: "blocked" },
  };
  const limit: ActionResult<unknown, FollowError> = {
    ...ok,
    status: "error",
    error: { code: "limit", details: { max: 5 } },
  };
  const failed: ActionResult<unknown, FollowError> = {
    status: "failed",
    error: new Error("offline"),
  };

  assert.equal(declaredError(undefined), undefined);
  assert.equal(declaredError(ok), undefined);
  assert.equal(declaredError(failed), undefined);
  assert.deepEqual(declaredError(limit), { code: "limit", details: { max: 5 } });

  assert.equal(isUnexpected(undefined), false);
  assert.equal(isUnexpected(ok), false);
  assert.equal(isUnexpected(failed, ["blocked", "limit"]), true);
  assert.equal(isUnexpected(blocked, ["blocked"]), false);
  assert.equal(isUnexpected(limit, ["blocked"]), true, "a declared error the app doesn't handle");
  assert.equal(isUnexpected(blocked), true);
});

test("actionError's error is typed by the descriptor", () => {
  assert.deepEqual(actionError(Follow, { code: "limit", details: { max: 5 } }).body, {
    protocol: 0,
    action: "follow",
    version: 1,
    status: "error",
    error: { code: "limit", details: { max: 5 } },
  });
});

test("pagedIsland puts a paged island on a screen, and answers its pages", async () => {
  const List: IslandDescriptor<{ items: string[] }> = { type: "list", version: 1 };
  const loadMore: { current?: () => void } = {};
  function ListView(props: { items: string[] }): ReactNode {
    const pages = usePages(props);
    loadMore.current = pages.loadMore;
    return createElement(
      "ol",
      null,
      `${pages.pages.flatMap((p) => p.items).join(",")} ${pages.status}`,
    );
  }
  const paged = pagedIsland({
    island: List,
    first: { props: { items: ["a", "b"] }, next: "c2" },
    pages: { c2: { props: { items: ["c"] }, next: "c3" } },
  });
  const { config, gateway } = createTestConfig({
    registry: new ReactIslandRegistry().registerComponent(List, ListView),
    handlers: paged.handlers,
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(createElement(ClientComposeProvider, { config }, paged.element)),
  );
  assert.equal(container.textContent, "a,b more");
  await act(async () => loadMore.current?.());
  assert.equal(container.textContent, "a,b,c more");
  await act(async () => loadMore.current?.()); // a cursor it wasn't given
  assert.equal(container.textContent, "a,b,c failed");
  assert.deepEqual(
    gateway.islandRequests().map((r) => [r.url, r.cursor]),
    [
      ["http://composer.test/screens/paged/islands/island", "c2"],
      ["http://composer.test/screens/paged/islands/island", "c3"],
    ],
  );
  await act(async () => root.unmount());
});
