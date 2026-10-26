import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { IslandDescriptor, ScreenRequest, ScreenResponse } from "@client-compose/protocol";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  type ClientComposeConfig,
  ClientComposeProvider,
  ComposedScreen,
  Island as IslandView,
  ReactIslandRegistry,
  useScreen,
} from "../src/index.ts";

const Header: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };
const Posts: IslandDescriptor<{ count: number }> = { type: "posts", version: 1 };
const Broken: IslandDescriptor<Record<string, never>> = { type: "broken", version: 1 };

const registry = new ReactIslandRegistry()
  .registerComponent(Header, ({ name }) => createElement("h1", null, name))
  .registerComponent(Posts, ({ count }) => createElement("p", null, `${count} posts`))
  .registerComponent(Broken, () => {
    throw new Error("render crash");
  });

type Island = ScreenResponse["islands"][number];
const ok = (key: string, type: string, props: object): Island => ({
  key,
  type,
  version: 1,
  status: "ok",
  props: props as never,
});

/** A fetch that serves queued responses and records requests. */
function fakeFetch(
  ...responses: (Island[] | { status: number } | { islands: Island[]; maxAge: number })[]
) {
  const requests: { body: ScreenRequest; headers: Headers }[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    requests.push({
      body: JSON.parse(String(init.body)),
      headers: new Headers(init.headers),
    });
    const next = responses.shift() ?? [];
    if ("status" in next) {
      return new Response("nope", { status: next.status });
    }
    const islands = Array.isArray(next) ? next : next.islands;
    const cache = Array.isArray(next) ? undefined : { maxAge: next.maxAge };
    return Response.json({
      protocol: 0,
      screen: "profile",
      islands,
      cache,
    });
  }) as typeof fetch;
  return { impl, requests };
}

async function render(node: ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    html: () => container.innerHTML,
    rerender: (n: ReactNode) => act(async () => root.render(n)),
    unmount: () => act(async () => root.unmount()),
  };
}

const config = (
  fetchImpl: typeof fetch,
  extra: Partial<ClientComposeConfig> = {},
): ClientComposeConfig => ({
  registry,
  baseUrl: "https://composer.test",
  client: { platform: "web", appVersion: "1.0.0" },
  fetch: fetchImpl,
  ...extra,
});

const withProvider = (cfg: ClientComposeConfig, child: ReactNode) =>
  createElement(ClientComposeProvider, { config: cfg }, child);

test("renders islands in order and declares capabilities", async () => {
  const f = fakeFetch([
    ok("posts", "posts", { count: 3 }),
    ok("header", "header", { name: "Ada" }),
  ]);
  const ui = await render(
    withProvider(
      config(f.impl, { headers: async () => ({ Authorization: "Bearer t" }) }),
      createElement(ComposedScreen, {
        screen: "profile",
        params: { userId: "u1" },
        loading: "loading…",
      }),
    ),
  );
  assert.equal(ui.html(), "<p>3 posts</p><h1>Ada</h1>");
  assert.deepEqual(f.requests[0].body.islands, {
    header: [1],
    posts: [1],
    broken: [1],
  });
  assert.deepEqual(f.requests[0].body.params, { userId: "u1" });
  assert.equal(f.requests[0].headers.get("authorization"), "Bearer t");
});

test("a crashing island is isolated and reported", async () => {
  const f = fakeFetch([
    ok("a", "header", { name: "Ada" }),
    ok("b", "broken", {}),
    ok("c", "posts", { count: 1 }),
  ]);
  const crashed: string[] = [];
  const originalError = console.error;
  console.error = () => {}; // React logs caught render errors.
  try {
    const ui = await render(
      withProvider(
        config(f.impl, { onRenderError: (key) => crashed.push(key) }),
        createElement(ComposedScreen, { screen: "profile" }),
      ),
    );
    assert.equal(ui.html(), "<h1>Ada</h1><p>1 posts</p>");
    assert.deepEqual(crashed, ["b"]);
  } finally {
    console.error = originalError;
  }
});

test("errored islands are hidden by default, or rendered with renderIslandError", async () => {
  const islands: Island[] = [
    ok("a", "header", { name: "Ada" }),
    {
      key: "p",
      type: "posts",
      version: 1,
      status: "error",
      error: { code: "timeout" },
    },
  ];
  const hidden = await render(
    withProvider(
      config(fakeFetch(islands).impl),
      createElement(ComposedScreen, { screen: "profile" }),
    ),
  );
  assert.equal(hidden.html(), "<h1>Ada</h1>");

  const shown = await render(
    withProvider(
      config(fakeFetch(islands).impl, {
        renderIslandError: (e) => createElement("i", null, e.error.code),
      }),
      createElement(ComposedScreen, { screen: "profile" }),
    ),
  );
  assert.equal(shown.html(), "<h1>Ada</h1><i>timeout</i>");
});

test("skipped islands are reported, not rendered", async () => {
  const skipped: string[] = [];
  const f = fakeFetch([ok("x", "mystery", {}), ok("a", "header", { name: "Ada" })]);
  const ui = await render(
    withProvider(
      config(f.impl, { onSkipped: (e, reason) => skipped.push(`${e.key}:${reason}`) }),
      createElement(ComposedScreen, { screen: "profile" }),
    ),
  );
  assert.equal(ui.html(), "<h1>Ada</h1>");
  assert.deepEqual(skipped, ["x:unknown_island"]);
});

test("shows renderError when the first request fails, and recovers on reload", async () => {
  const f = fakeFetch({ status: 502 }, [ok("a", "header", { name: "Ada" })]);
  let retry = () => {};
  const ui = await render(
    withProvider(
      config(f.impl),
      createElement(ComposedScreen, {
        screen: "profile",
        renderError: (error, reload) => {
          retry = reload;
          return createElement("b", null, (error as { status: number }).status);
        },
      }),
    ),
  );
  assert.equal(ui.html(), "<b>502</b>");
  await act(async () => retry());
  assert.equal(ui.html(), "<h1>Ada</h1>");
});

test("reuses a response within cache.maxAge; reload bypasses the cache", async () => {
  const f = fakeFetch(
    { islands: [ok("a", "header", { name: "first" })], maxAge: 60 },
    { islands: [ok("a", "header", { name: "second" })], maxAge: 60 },
  );
  let reload = () => {};
  function Screen() {
    const s = useScreen("profile");
    reload = s.reload;
    return createElement(
      "div",
      null,
      s.islands.map((island) => createElement(IslandView, { key: island.key, island })),
    );
  }
  function App() {
    const [mounted, setMounted] = useState(true);
    toggle = () => setMounted((m) => !m);
    return mounted ? createElement(Screen) : null;
  }
  let toggle = () => {};
  const ui = await render(withProvider(config(f.impl), createElement(App)));
  assert.equal(ui.html(), "<div><h1>first</h1></div>");

  await act(async () => toggle()); // unmount
  await act(async () => toggle()); // mount again: served from cache, no flash
  assert.equal(ui.html(), "<div><h1>first</h1></div>");
  assert.equal(f.requests.length, 1);

  await act(async () => reload());
  assert.equal(ui.html(), "<div><h1>second</h1></div>");
  assert.equal(f.requests.length, 2);
});

test("refetches when params change", async () => {
  const f = fakeFetch([ok("a", "header", { name: "u1" })], [ok("a", "header", { name: "u2" })]);
  const cfg = config(f.impl);
  const screen = (userId: string) =>
    withProvider(cfg, createElement(ComposedScreen, { screen: "profile", params: { userId } }));
  const ui = await render(screen("u1"));
  assert.equal(ui.html(), "<h1>u1</h1>");
  await ui.rerender(screen("u2"));
  assert.equal(ui.html(), "<h1>u2</h1>");
  assert.deepEqual(
    f.requests.map((r) => r.body.params),
    [{ userId: "u1" }, { userId: "u2" }],
  );
});

test("lets callers lay out the islands themselves", async () => {
  const f = fakeFetch([ok("a", "header", { name: "Ada" }), ok("b", "posts", { count: 2 })]);
  const ui = await render(
    withProvider(
      config(f.impl),
      createElement(ComposedScreen, {
        screen: "profile",
        children: (islands) => createElement("main", null, islands),
      }),
    ),
  );
  assert.equal(ui.html(), "<main><h1>Ada</h1><p>2 posts</p></main>");
});
