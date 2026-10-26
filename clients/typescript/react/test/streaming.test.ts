// Screens as they stream in (spec §4.6): islands show once the head arrives, each pending one as its
// placeholder (or nothing) until its line does.
import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { IslandDescriptor } from "@client-compose/protocol";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  type ClientComposeConfig,
  ClientComposeProvider,
  ComposedScreen,
  ReactIslandRegistry,
  type ScreenState,
} from "../src/index.ts";
import {
  createTestConfig,
  type FakeGatewayHandlers,
  island,
  islandError,
  pending,
  screen,
  streamedScreen,
} from "../src/testing.ts";

const Header: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };
const Posts: IslandDescriptor<{ count: number }> = { type: "posts", version: 1 };
const Ads: IslandDescriptor<{ text: string }> = { type: "ads", version: 1 };

const registry = new ReactIslandRegistry()
  .registerComponent(Header, ({ name }) => createElement("h1", null, name))
  .registerComponent(Posts, ({ count }) => createElement("p", null, `${count} posts`), {
    placeholder: () => createElement("p", { "aria-busy": true }, "…"),
  })
  .registerComponent(Ads, ({ text }) => createElement("aside", null, text));

/** Renders a profile screen from the fake composer; each test gives its own answers. */
async function render(
  handlers: FakeGatewayHandlers,
  options: { progressive?: boolean; config?: Partial<ClientComposeConfig> } = {},
) {
  const { config, gateway } = createTestConfig({
    registry,
    handlers,
    renderIslandError: (e) => createElement("em", null, `error:${e.key}:${e.error.code}`),
    ...options.config,
  });
  const states: ScreenState[] = [];
  const container = document.createElement("div");
  const root = createRoot(container);
  const view = createElement(
    ClientComposeProvider,
    { config },
    createElement(ComposedScreen, {
      screen: "profile",
      progressive: options.progressive,
      loading: "loading",
      children: (nodes: ReactNode[], state: ScreenState) => {
        states.push(state);
        return createElement(Fragment, null, ...nodes);
      },
    }),
  );
  await act(async () => root.render(view));
  return {
    html: () => container.innerHTML,
    latest: () => states.at(-1),
    gateway,
    unmount: () => act(async () => root.unmount()),
  };
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

test("shows the head at once, placeholders for pending islands, and each as it arrives", async () => {
  const profile = streamedScreen("profile", [
    island("header", Header, { name: "Ada" }),
    pending("posts", Posts),
    pending("ads", Ads), // no placeholder: nothing until it arrives
  ]);
  const view = await render({ screens: { profile: () => profile } });
  await settle();
  assert.equal(view.html(), '<h1>Ada</h1><p aria-busy="true">…</p>');
  assert.equal(view.latest()?.streaming, true);

  // Ads, below posts, shows as soon as it arrives: it isn't held back for posts.
  await act(async () => profile.send(island("ads", Ads, { text: "Buy" })));
  await settle();
  assert.equal(view.html(), '<h1>Ada</h1><p aria-busy="true">…</p><aside>Buy</aside>');

  await act(async () => {
    profile.send(island("posts", Posts, { count: 3 }));
    profile.end();
  });
  await settle();
  assert.equal(view.html(), "<h1>Ada</h1><p>3 posts</p><aside>Buy</aside>");
  assert.equal(view.latest()?.streaming, false);
  assert.equal(view.latest()?.refreshing, false);
  await view.unmount();
});

test("an island that fails, or never arrives, is an error", async () => {
  const profile = streamedScreen("profile", [
    island("header", Header, { name: "Ada" }),
    pending("posts", Posts),
    pending("ads", Ads),
  ]);
  const view = await render({ screens: { profile: () => profile } });
  await act(async () => {
    profile.send(islandError("ads", Ads, { code: "resolve_failed" }));
    profile.cut(); // the connection drops before posts
  });
  await settle();
  assert.equal(
    view.html(),
    "<h1>Ada</h1><em>error:posts:incomplete</em><em>error:ads:resolve_failed</em>",
  );
  await view.unmount();
});

test("progressive: false waits for the whole screen", async () => {
  const profile = streamedScreen("profile", [
    island("header", Header, { name: "Ada" }),
    pending("posts", Posts),
  ]);
  const view = await render({ screens: { profile: () => profile } }, { progressive: false });
  await settle();
  assert.equal(view.html(), "loading");
  await act(async () => {
    profile.send(island("posts", Posts, { count: 3 }));
    profile.end();
  });
  await settle();
  assert.equal(view.html(), "<h1>Ada</h1><p>3 posts</p>");
  await view.unmount();
});

test("the config's progressive: false holds every screen", async () => {
  const profile = streamedScreen("profile", [pending("posts", Posts)]);
  const view = await render(
    { screens: { profile: () => profile } },
    { config: { progressive: false } },
  );
  await settle();
  assert.equal(view.html(), "loading");
  await act(async () => {
    profile.send(island("posts", Posts, { count: 1 }));
    profile.end();
  });
  await settle();
  assert.equal(view.html(), "<p>1 posts</p>");
  await view.unmount();
});

test("a reload keeps showing an island until its new one arrives", async () => {
  const reloading = streamedScreen("profile", [
    island("header", Header, { name: "Ada" }),
    pending("posts", Posts),
  ]);
  const answers = [
    screen("profile", [
      island("header", Header, { name: "Ada" }),
      island("posts", Posts, { count: 1 }),
    ]),
    reloading,
  ];
  const view = await render({
    screens: {
      profile: () => {
        const next = answers.shift();
        assert.ok(next);
        return next;
      },
    },
  });
  await settle();
  assert.equal(view.html(), "<h1>Ada</h1><p>1 posts</p>");
  await act(async () => view.latest()?.reload());
  await settle();
  assert.equal(view.html(), "<h1>Ada</h1><p>1 posts</p>", "not its placeholder");
  await act(async () => {
    reloading.send(island("posts", Posts, { count: 2 }));
    reloading.end();
  });
  await settle();
  assert.equal(view.html(), "<h1>Ada</h1><p>2 posts</p>");
  await view.unmount();
});
