import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { IslandDescriptor } from "@client-compose/protocol";
import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  ClientComposeProvider,
  ComposedScreen,
  type PagesState,
  ReactIslandRegistry,
  usePages,
} from "../src/index.ts";
import {
  createTestConfig,
  type FakeGatewayHandlers,
  island,
  islandResponse,
  screen,
  screenError,
} from "../src/testing.ts";

const List: IslandDescriptor<{ items: string[] }> = { type: "list", version: 2 };

// The island lays out every page's items, and hands its state to the test once it has rendered.
const seen: PagesState<{ items: string[] }>[] = [];
const latest = () => seen[seen.length - 1]!;
function ListView(props: { items: string[] }): ReactNode {
  const pages = usePages(props);
  useEffect(() => {
    seen.push(pages);
  });
  return createElement("ol", null, pages.pages.flatMap((p) => p.items).join(","));
}
const registry = new ReactIslandRegistry().registerComponent(List, ListView);

async function render(handlers: FakeGatewayHandlers, params: Record<string, string>) {
  const { config, gateway } = createTestConfig({ registry, handlers });
  const container = document.createElement("div");
  const root = createRoot(container);
  const show = (p: Record<string, string>) =>
    act(async () =>
      root.render(
        createElement(
          ClientComposeProvider,
          { config },
          createElement(ComposedScreen, { screen: "search", params: p }),
        ),
      ),
    );
  await show(params);
  return { container, gateway, root, show };
}

const firstPage = (q: string) =>
  screen("search", [island("results", List, { items: [`${q}1`, `${q}2`] }, "c2")]);

test("usePages fetches the next pages of the island it's in, until there are no more", async () => {
  const { container, gateway, root } = await render(
    {
      screens: { search: (r) => firstPage(r.params.q ?? "") },
      islands: {
        "search/results": (r) =>
          r.cursor === "c2"
            ? islandResponse("search", island("results", List, { items: ["a3", "a4"] }, "c3"))
            : islandResponse("search", island("results", List, { items: ["a5"] })),
      },
    },
    { q: "a" },
  );
  assert.equal(container.textContent, "a1,a2");
  assert.equal(latest().status, "more");

  await act(async () => latest().loadMore());
  assert.equal(container.textContent, "a1,a2,a3,a4");
  await act(async () => latest().loadMore());
  assert.equal(container.textContent, "a1,a2,a3,a4,a5");
  assert.equal(latest().status, "end");
  await act(async () => latest().loadMore()); // nothing more to load

  assert.deepEqual(
    gateway.islandRequests().map((r) => [r.url, r.key, r.version, r.cursor, r.params]),
    [
      ["http://composer.test/screens/search/islands/results", "results", 2, "c2", { q: "a" }],
      ["http://composer.test/screens/search/islands/results", "results", 2, "c3", { q: "a" }],
    ],
  );
  await act(async () => root.unmount());
});

test("a failed page can be tried again; new props start again from them", async () => {
  const answers = { count: 0 };
  const { container, root, show } = await render(
    {
      screens: { search: (r) => firstPage(r.params.q ?? "") },
      islands: {
        "search/results": () => {
          answers.count += 1;
          if (answers.count === 1) return screenError(400, "invalid_cursor");
          if (answers.count === 2)
            return islandResponse("search", {
              key: "results",
              type: "list",
              version: 2,
              status: "error",
              error: { code: "timeout", retryable: true },
            });
          return islandResponse("search", island("results", List, { items: ["a3"] }));
        },
      },
    },
    { q: "a" },
  );
  await act(async () => latest().loadMore());
  assert.equal(latest().status, "failed");
  assert.equal((latest().error as { code?: string }).code, "invalid_cursor");
  await act(async () => latest().loadMore());
  assert.deepEqual(latest().error, { code: "timeout", retryable: true });
  await act(async () => latest().loadMore());
  assert.equal(container.textContent, "a1,a2,a3");
  assert.equal(latest().status, "end");

  // Another search: the island starts again from its new first page.
  await show({ q: "b" });
  assert.equal(container.textContent, "b1,b2");
  assert.equal(latest().status, "more");
  await act(async () => root.unmount());
});

test("an island without pages is its one page", async () => {
  const { container, gateway, root } = await render(
    { screens: { search: () => screen("search", [island("results", List, { items: ["x"] })]) } },
    {},
  );
  assert.equal(latest().status, "end");
  await act(async () => latest().loadMore());
  assert.equal(container.textContent, "x");
  assert.equal(gateway.islandRequests().length, 0);
  await act(async () => root.unmount());
});
