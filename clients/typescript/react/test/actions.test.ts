import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ActionDescriptor,
  ActionRequest,
  IslandDescriptor,
  ScreenRef,
} from "@client-compose/protocol";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  ActionFetchError,
  type ActionState,
  type ClientComposeConfig,
  ClientComposeProvider,
  ComposedScreen,
  ReactIslandRegistry,
  useAction,
} from "../src/index.ts";

const Count: IslandDescriptor<{ n: number }> = { type: "count", version: 1 };
const registry = new ReactIslandRegistry().registerComponent(Count, ({ n }) =>
  createElement("b", null, String(n)),
);

type FollowError = { code: "blocked" } | { code: "limit"; details: { max: number } };
const Follow: ActionDescriptor<{ userId: string }, { followers: number }, FollowError> = {
  action: "follow",
  version: 1,
  errors: ["blocked", "limit"],
  input: { type: "object" },
};

/**
 * A composer stand-in: screens answer with how many times each screen+params was fetched; the
 * action answers with `actionResponse`.
 */
function fakeComposer(actionResponse: () => Response) {
  const screenFetches = new Map<string, number>();
  const actions: { url: string; body: ActionRequest; headers: Record<string, string> }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.includes("/actions/")) {
      actions.push({
        url,
        body,
        headers: init.headers as Record<string, string>,
      });
      return actionResponse();
    }
    const key = `${body.screen}:${JSON.stringify(body.params ?? {})}`;
    const n = (screenFetches.get(key) ?? 0) + 1;
    screenFetches.set(key, n);
    const islands = [
      {
        key: "c",
        type: "count",
        version: 1,
        status: "ok",
        props: { n },
      },
    ];
    return Response.json({
      protocol: 0,
      screen: body.screen,
      islands,
      cache: { maxAge: 60 },
    });
  }) as typeof fetch;
  return {
    impl,
    screenFetches,
    actions,
  };
}

const okResponse = (effects?: object) =>
  Response.json({
    protocol: 0,
    action: "follow",
    version: 1,
    status: "ok",
    result: { followers: 7 },
    ...(effects && { effects }),
  });

async function setup(
  cfg: ClientComposeConfig,
  screens: { screen: string; params?: Record<string, string> }[],
) {
  let action!: ActionState<{ userId: string }, { followers: number }, FollowError>;
  function Harness(): ReactNode {
    action = useAction(Follow);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const tree = createElement(
    ClientComposeProvider,
    { config: cfg },
    createElement(Harness),
    ...screens.map((s) =>
      createElement(
        "section",
        { key: `${s.screen}:${JSON.stringify(s.params ?? {})}` },
        createElement(ComposedScreen, s),
      ),
    ),
  );
  await act(async () => root.render(tree));
  return {
    html: () => container.innerHTML,
    action: () => action,
    run: async (input: { userId: string }, options?: { idempotencyKey?: string }) => {
      let result!: Awaited<ReturnType<typeof action.run>>;
      await act(async () => {
        result = await action.run(input, options);
      });
      return result;
    },
    unmount: () => act(async () => root.unmount()),
  };
}

const baseConfig = (
  fetchImpl: typeof fetch,
  extra: Partial<ClientComposeConfig> = {},
): ClientComposeConfig => ({
  registry,
  baseUrl: "https://composer.test",
  client: { platform: "web", appVersion: "1.0.0" },
  fetch: fetchImpl,
  ...extra,
});

test("run posts the action with the configured headers and resolves with the result", async () => {
  const c = fakeComposer(() => okResponse());
  const ui = await setup(
    baseConfig(c.impl, { headers: () => ({ Authorization: "Bearer t" }) }),
    [],
  );
  const res = await ui.run({ userId: "u1" });
  assert.equal(res.status === "ok" && res.result.followers, 7);
  assert.equal(c.actions[0].url, "https://composer.test/actions/follow");
  assert.equal(c.actions[0].headers.Authorization, "Bearer t");
  assert.deepEqual(c.actions[0].body.input, { userId: "u1" });
  assert.equal(typeof c.actions[0].body.idempotencyKey, "string");
  assert.equal(ui.action().last?.status, "ok");
  await ui.unmount();
});

test("invalidate reloads the matching screens on show, and only those", async () => {
  const invalidated: ScreenRef[][] = [];
  const c = fakeComposer(() =>
    okResponse({
      invalidate: [{ screen: "profile", params: { userId: "u1" } }, { screen: "feed" }],
    }),
  );
  const ui = await setup(baseConfig(c.impl, { onInvalidate: (refs) => invalidated.push(refs) }), [
    { screen: "profile", params: { userId: "u1" } },
    { screen: "profile", params: { userId: "u2" } },
    { screen: "feed", params: { page: "2" } },
    { screen: "settings" },
  ]);
  assert.equal(ui.html(), "<section><b>1</b></section>".repeat(4));

  await ui.run({ userId: "u1" });
  assert.equal(
    ui.html(),
    ["<b>2</b>", "<b>1</b>", "<b>2</b>", "<b>1</b>"].map((b) => `<section>${b}</section>`).join(""),
  );
  assert.deepEqual(invalidated, [
    [{ screen: "profile", params: { userId: "u1" } }, { screen: "feed" }],
  ]);
  await ui.unmount();
});

test("invalidate drops cached responses, so the next visit fetches again", async () => {
  const c = fakeComposer(() => okResponse({ invalidate: [{ screen: "feed" }] }));
  const cfg = baseConfig(c.impl);
  let action!: ActionState<{ userId: string }, { followers: number }, FollowError>;
  function Harness(): ReactNode {
    action = useAction(Follow);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  // One provider throughout (it owns the cache); the feed is shown, hidden, then shown again.
  const show = (feed: boolean) =>
    act(async () =>
      root.render(
        createElement(
          ClientComposeProvider,
          { config: cfg },
          createElement(Harness),
          feed && createElement(ComposedScreen, { screen: "feed" }),
        ),
      ),
    );

  await show(true);
  await show(false);
  await show(true);
  assert.equal(container.innerHTML, "<b>1</b>", "a revisit within maxAge uses the cache");
  await show(false);
  await act(async () => {
    await action.run({ userId: "u1" });
  });
  await show(true);
  assert.equal(container.innerHTML, "<b>2</b>", "after the action, the revisit fetches again");
  await act(async () => root.unmount());
});

test("navigate is passed to onNavigate", async () => {
  const navigated: ScreenRef[] = [];
  const c = fakeComposer(() =>
    okResponse({ navigate: { screen: "profile", params: { userId: "u1" } } }),
  );
  const ui = await setup(baseConfig(c.impl, { onNavigate: (ref) => navigated.push(ref) }), []);
  await ui.run({ userId: "u1" });
  assert.deepEqual(navigated, [{ screen: "profile", params: { userId: "u1" } }]);
  await ui.unmount();
});

test("declared errors are outcomes, and apply no effects", async () => {
  const navigated: ScreenRef[] = [];
  const c = fakeComposer(() =>
    Response.json({
      protocol: 0,
      action: "follow",
      version: 1,
      status: "error",
      error: { code: "limit", details: { max: 5 } },
    }),
  );
  const ui = await setup(baseConfig(c.impl, { onNavigate: (ref) => navigated.push(ref) }), []);
  const res = await ui.run({ userId: "u1" });
  assert.equal(res.status === "error" && res.error.code === "limit" && res.error.details.max, 5);
  assert.deepEqual(navigated, []);
  await ui.unmount();
});

test("a failed call resolves with status failed, and reset forgets it", async () => {
  const c = fakeComposer(() =>
    Response.json({ protocol: 0, error: { code: "unauthenticated" } }, { status: 401 }),
  );
  const ui = await setup(baseConfig(c.impl), []);
  const res = await ui.run({ userId: "u1" });
  assert.ok(
    res.status === "failed" &&
      res.error instanceof ActionFetchError &&
      res.error.code === "unauthenticated",
  );
  assert.equal(ui.action().last?.status, "failed");
  await act(async () => ui.action().reset());
  assert.equal(ui.action().last, undefined);
  await ui.unmount();
});

test("performAction replaces the HTTP call, and pending is true while it runs", async () => {
  const c = fakeComposer(() => okResponse());
  let release!: () => void;
  const seen: ActionRequest[] = [];
  const ui = await setup(
    baseConfig(c.impl, {
      performAction: async (request) => {
        seen.push(request);
        await new Promise<void>((resolve) => (release = resolve));
        return {
          protocol: 0,
          action: "follow",
          version: 1,
          status: "ok",
          result: { followers: 1 },
        };
      },
    }),
    [],
  );
  let running!: Promise<unknown>;
  await act(async () => {
    running = ui.action().run({ userId: "u1" }, { idempotencyKey: "k1" });
  });
  assert.equal(ui.action().pending, true);
  await act(async () => {
    release();
    await running;
  });
  assert.equal(ui.action().pending, false);
  assert.deepEqual([seen[0].idempotencyKey, c.actions.length], ["k1", 0]);
  await ui.unmount();
});
