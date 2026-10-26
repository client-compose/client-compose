// Classic server rendering: fetch on the server with loadScreen, render HTML with initialResponse,
// then hydrate on the client without a second request.
import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { screenLines } from "@client-compose/client";
import type { IslandDescriptor, ScreenRequest, ScreenResponse } from "@client-compose/protocol";
import { act, createElement, type ReactNode, StrictMode, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

import {
  type ClientComposeConfig,
  ClientComposeProvider,
  ComposedScreen,
  loadScreen,
  ReactIslandRegistry,
} from "../src/index.ts";

const Header: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };
const Counter: IslandDescriptor<{ start: number }> = { type: "counter", version: 1 };
const Broken: IslandDescriptor<Record<string, never>> = { type: "broken", version: 1 };

function CounterIsland({ start }: { start: number }) {
  const [n, setN] = useState(start);
  return createElement("button", { onClick: () => setN(n + 1) }, `count ${n}`);
}

const registry = new ReactIslandRegistry()
  .registerComponent(Header, ({ name }) => createElement("h1", null, name))
  .registerComponent(Counter, CounterIsland)
  .registerComponent(Broken, () => {
    throw new Error("broken island");
  });

const response = (name: string): ScreenResponse => ({
  protocol: 0,
  screen: "profile",
  islands: [
    {
      key: "h",
      type: "header",
      version: 1,
      status: "ok",
      props: { name },
    },
    {
      key: "c",
      type: "counter",
      version: 1,
      status: "ok",
      props: { start: 1 },
    },
  ],
});

/** A screen's stream, all at once: what the composer answers (spec §4.6). */
const streamed = (screen: object) =>
  new Response(screenLines(screen as ScreenResponse), {
    headers: { "content-type": "application/jsonl" },
  });

function recordingFetch(...responses: ScreenResponse[]) {
  const requests: { url: string; init: RequestInit; body: ScreenRequest }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    requests.push({
      url,
      init,
      body: JSON.parse(String(init.body)),
    });
    return streamed(responses.shift() ?? response("?"));
  }) as typeof fetch;
  return { impl, requests };
}

const config = (fetchImpl: typeof fetch): ClientComposeConfig => ({
  registry,
  baseUrl: "https://composer.test",
  client: { platform: "web", appVersion: "1.0.0" },
  fetch: fetchImpl,
});

const app = (
  cfg: ClientComposeConfig,
  userId: string,
  initialResponse?: ScreenResponse,
): ReactNode =>
  createElement(
    ClientComposeProvider,
    { config: cfg },
    createElement(ComposedScreen, {
      screen: "profile",
      params: { userId },
      initialResponse,
      loading: "loading",
    }),
  );

/** Hydrate server HTML, failing on any hydration warning. */
async function hydrate(html: string, node: ReactNode) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const errors: unknown[][] = [];
  const recoverable: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(container, node, { onRecoverableError: (e) => recoverable.push(e) });
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(recoverable, [], "hydration mismatch");
  assert.deepEqual(errors, [], "console errors during hydration");
  return { container, root };
}

test("loadScreen declares capabilities and merges headers and request options", async () => {
  const f = recordingFetch(response("Ada"));
  const result = await loadScreen(
    {
      ...config(f.impl),
      headers: async () => ({ Authorization: "Bearer t" }),
      requestInit: { cache: "no-store" },
    },
    "profile",
    { userId: "u1" },
  );
  assert.equal(result.islands.length, 2);
  assert.equal(f.requests[0].url, "https://composer.test/screens/profile");
  assert.deepEqual(f.requests[0].body.islands, {
    header: [1],
    counter: [1],
    broken: [1],
  });
  assert.deepEqual(f.requests[0].body.params, { userId: "u1" });
  assert.equal(new Headers(f.requests[0].init.headers).get("authorization"), "Bearer t");
  assert.equal(f.requests[0].init.cache, "no-store");
});

test("without initialResponse, the server renders the loading state", () => {
  assert.equal(renderToString(app(config(recordingFetch().impl), "u1")), "loading");
});

test("server renders islands from initialResponse, and hydration doesn't refetch", async () => {
  const server = recordingFetch(response("Ada"));
  const initial = await loadScreen(config(server.impl), "profile", { userId: "u1" });
  const html = renderToString(app(config(recordingFetch().impl), "u1", initial));
  // Each island is its own Suspense boundary (<!--$-->…<!--/$-->), so it can't break the others.
  assert.equal(html, "<!--$--><h1>Ada</h1><!--/$--><!--$--><button>count 1</button><!--/$-->");

  const browser = recordingFetch(response("Grace"));
  const cfg = config(browser.impl);
  const { container, root } = await hydrate(html, app(cfg, "u1", initial));
  assert.equal(browser.requests.length, 0, "hydration must not fetch");

  // Interactive after hydration.
  await act(async () => container.querySelector("button")!.click());
  assert.match(container.innerHTML, /count 2/);

  // Navigating to other params fetches as usual.
  await act(async () => root.render(app(cfg, "u2", initial)));
  assert.equal(browser.requests.length, 1);
  assert.match(container.innerHTML, /<h1>Grace<\/h1>/);
});

test("StrictMode's double mount doesn't refetch a server-rendered screen", async () => {
  const initial = response("Ada");
  const html = renderToString(
    createElement(StrictMode, null, app(config(recordingFetch().impl), "u1", initial)),
  );
  const browser = recordingFetch();
  await hydrate(html, createElement(StrictMode, null, app(config(browser.impl), "u1", initial)));
  assert.equal(browser.requests.length, 0);
});

test("a crashing island is left out of the server HTML and hidden after hydration", async () => {
  const initial: ScreenResponse = {
    protocol: 0,
    screen: "profile",
    islands: [
      {
        key: "h",
        type: "header",
        version: 1,
        status: "ok",
        props: { name: "Ada" },
      },
      {
        key: "b",
        type: "broken",
        version: 1,
        status: "ok",
        props: {},
      },
      {
        key: "c",
        type: "counter",
        version: 1,
        status: "ok",
        props: { start: 1 },
      },
    ],
  };
  const quiet = console.error;
  console.error = () => {};
  let html: string;
  try {
    html = renderToString(app(config(recordingFetch().impl), "u1", initial));
  } finally {
    console.error = quiet;
  }
  // The broken island's boundary renders its (empty) fallback; its neighbours render normally.
  assert.match(
    html,
    /^<!--\$--><h1>Ada<\/h1><!--\/\$--><!--\$!-->.*<!--\/\$--><!--\$--><button>count 1<\/button><!--\/\$-->$/s,
  );

  const crashed: string[] = [];
  const cfg = {
    ...config(recordingFetch().impl),
    onRenderError: (key: string) => crashed.push(key),
  };
  const container = document.createElement("div");
  container.innerHTML = html;
  console.error = () => {};
  try {
    await act(async () => {
      hydrateRoot(container, app(cfg, "u1", initial), { onRecoverableError: () => {} });
    });
  } finally {
    console.error = quiet;
  }
  assert.equal(container.textContent, "Adacount 1");
  assert.deepEqual(crashed, ["b"]);
});

test("a new initialResponse from the server is used without a request (navigation, refresh)", async () => {
  const browser = recordingFetch();
  const cfg = config(browser.impl);
  const first = response("Ada");
  const html = renderToString(app(cfg, "u1", first));
  const { container, root } = await hydrate(html, app(cfg, "u1", first));

  // A framework navigation re-runs the server page: new params, new server response.
  await act(async () => root.render(app(cfg, "u2", response("Grace"))));
  assert.match(container.innerHTML, /<h1>Grace<\/h1>/);

  // A refresh with the same params delivers fresh server data.
  await act(async () => root.render(app(cfg, "u2", response("Grace Hopper"))));
  assert.match(container.innerHTML, /<h1>Grace Hopper<\/h1>/);
  assert.equal(browser.requests.length, 0);
});
