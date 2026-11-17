// A screen read before an action finished, and shown after it (spec §5.3): it catches up with the
// action, by the times both say (`at`), rather than showing what the action changed as it was.
import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { screenLines } from "@client-compose/client";
import type {
  ActionDescriptor,
  ActionEffects,
  IslandDescriptor,
  ScreenResponse,
} from "@client-compose/protocol";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
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

const Bump: ActionDescriptor<Record<string, never>, Record<string, never>, never> = {
  action: "bump",
  version: 1,
  errors: [],
  input: { type: "object" },
};

/** A screen the composer read at `at`, its count `n`. */
interface Read {
  at: number;
  n: number;
}

/**
 * A composer stand-in: each screen request answers with the next of `reads`; the action answers
 * with `effects`.
 */
function fakeComposer(effects: ActionEffects, reads: Read[]) {
  const fetched: number[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    if (url.includes("/actions/")) {
      return Response.json({
        protocol: 0,
        action: "bump",
        version: 1,
        status: "ok",
        result: {},
        effects,
      });
    }

    const body = JSON.parse(String(init.body));
    const read = reads.shift() ?? { at: 9999, n: -1 };
    fetched.push(read.n);
    const screen: ScreenResponse = {
      protocol: 0,
      screen: body.screen,
      islands: [
        {
          key: "c",
          type: "count",
          version: 1,
          status: "ok",
          props: { n: read.n },
        },
      ],
      at: read.at,
    };

    return new Response(screenLines(screen), { headers: { "content-type": "application/jsonl" } });
  }) as typeof fetch;

  return { impl, fetched };
}

/** The provider with the action ready, and nothing on show until `show`. */
async function setup(fetchImpl: typeof fetch) {
  let bump!: ActionState<Record<string, never>, Record<string, never>, never>;
  function Harness(): ReactNode {
    bump = useAction(Bump);
    return null;
  }

  const config: ClientComposeConfig = {
    registry,
    baseUrl: "https://composer.test",
    client: { platform: "web", appVersion: "1.0.0" },
    fetch: fetchImpl,
    cache: false,
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = (content: ReactNode) =>
    act(async () =>
      root.render(
        createElement(ClientComposeProvider, { config }, createElement(Harness), content),
      ),
    );
  await render(null);

  return {
    html: () => container.innerHTML,
    run: () =>
      act(async () => {
        await bump.run({});
      }),
    show: () => render(createElement(ComposedScreen, { screen: "s" })),
    unmount: () => act(async () => root.unmount()),
  };
}

const updated = (n: number, at: number): ActionEffects => ({
  update: [
    {
      screen: "s",
      params: {},
      island: {
        key: "c",
        type: "count",
        version: 1,
        status: "ok",
        props: { n },
      },
    },
  ],
  at,
});

test("a screen read before an action finished shows what it left", async () => {
  const c = fakeComposer(updated(99, 2000), [{ at: 1000, n: 1 }]);
  const app = await setup(c.impl);

  // The action finishes with nothing on show; then the screen, read before it, arrives.
  await app.run();
  await app.show();

  assert.equal(app.html(), "<b>99</b>");
  assert.deepEqual(c.fetched, [1], "no request more");
  await app.unmount();
});

test("a screen read after an action finished shows what it read", async () => {
  const c = fakeComposer(updated(99, 2000), [{ at: 3000, n: 100 }]);
  const app = await setup(c.impl);

  await app.run();
  await app.show();

  assert.equal(app.html(), "<b>100</b>");
  await app.unmount();
});

test("a screen read before an action that invalidated it is loaded again, once", async () => {
  const c = fakeComposer({ invalidate: [{ screen: "s" }], at: 2000 }, [
    { at: 1000, n: 1 },
    { at: 3000, n: 2 },
  ]);
  const app = await setup(c.impl);

  await app.run();
  await app.show();

  assert.equal(app.html(), "<b>2</b>");
  assert.deepEqual(c.fetched, [1, 2]);
  await app.unmount();
});

test("a screen that says no at is taken as current", async () => {
  const c = fakeComposer({ invalidate: [{ screen: "s" }], at: 2000 }, []);
  const noAt = (async (url: string, init: RequestInit) => {
    const res = await c.impl(url, init);
    if (url.includes("/actions/")) {
      return res;
    }

    const text = (await res.text()).replace(/,"at":\d+/, "");

    return new Response(text, { headers: { "content-type": "application/jsonl" } });
  }) as typeof fetch;
  const app = await setup(noAt);

  await app.run();
  await app.show();

  assert.equal(app.html(), "<b>-1</b>");
  assert.deepEqual(c.fetched, [-1]);
  await app.unmount();
});
