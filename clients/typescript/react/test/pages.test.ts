import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type { IslandDescriptor, IslandEntry, IslandRequest } from "@client-compose/protocol";
import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";

import {
  type ClientComposeConfig,
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

type ListProps = { items: string[] };
const List: IslandDescriptor<ListProps> = { type: "list", version: 2 };

/**
 * Renders a search screen whose results island lays out every page's items. Each call has its own
 * island component and states, so a test only sees the island it rendered.
 */
async function render(
  handlers: FakeGatewayHandlers,
  params: Record<string, string>,
  overrides: Partial<ClientComposeConfig> = {},
) {
  const states: PagesState<ListProps>[] = [];
  function ListView(props: ListProps): ReactNode {
    const pages = usePages(props);
    useEffect(() => {
      states.push(pages);
    });
    return createElement("ol", null, pages.pages.flatMap((page) => page.items).join(","));
  }
  const registry = new ReactIslandRegistry().registerComponent(List, ListView);
  const { config, gateway } = createTestConfig({
    registry,
    handlers,
    ...overrides,
  });
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
  /** The island's state as it last rendered. */
  const latest = (): PagesState<ListProps> => {
    const state = states.at(-1);
    assert.ok(state, "the island hasn't rendered");
    return state;
  };
  const unmount = () => act(async () => root.unmount());
  return {
    container,
    gateway,
    show,
    latest,
    unmount,
  };
}

const searchScreen: FakeGatewayHandlers["screens"] = {
  search: (r) => {
    const q = r.params.q ?? "";
    return screen("search", [island("results", List, { items: [`${q}1`, `${q}2`] }, "c2")]);
  },
};

test("usePages fetches the next pages of the island it's in, until there are no more", async () => {
  const { container, gateway, latest, unmount } = await render(
    {
      screens: searchScreen,
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
  await unmount();
});

test("a failed page can be tried again; new props start again from them", async () => {
  const answers = { count: 0 };
  const { container, latest, show, unmount } = await render(
    {
      screens: searchScreen,
      islands: {
        "search/results": () => {
          answers.count += 1;
          if (answers.count === 1) {
            return screenError(400, "invalid_cursor");
          }
          if (answers.count === 2) {
            return islandResponse("search", {
              key: "results",
              type: "list",
              version: 2,
              status: "error",
              error: { code: "timeout", retryable: true },
            });
          }
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
  await unmount();
});

test("pages go through the config's loadIsland, and one that arrives late is dropped", async () => {
  const asked: IslandRequest[] = [];
  const answers: ((entry: IslandEntry) => void)[] = [];
  const loadIsland = (request: IslandRequest) =>
    new Promise<IslandEntry>((resolve) => {
      asked.push(request);
      answers.push(resolve);
    });
  const { container, latest, show, unmount } = await render(
    { screens: searchScreen },
    { q: "a" },
    { loadIsland },
  );
  await act(async () => latest().loadMore());
  assert.equal(latest().status, "loading");
  assert.deepEqual(
    asked.map((r) => [r.screen, r.key, r.version, r.cursor]),
    [["search", "results", 2, "c2"]],
  );

  // Searched again before a's page came back: it's dropped when it does.
  await show({ q: "b" });
  await act(async () => answers[0]?.(island("results", List, { items: ["late"] })));
  assert.equal(container.textContent, "b1,b2");
  assert.equal(latest().status, "more");
  await unmount();
});

test("an island without pages is its one page", async () => {
  const { container, gateway, latest, unmount } = await render(
    { screens: { search: () => screen("search", [island("results", List, { items: ["x"] })]) } },
    {},
  );
  assert.equal(latest().status, "end");
  await act(async () => latest().loadMore());
  assert.equal(container.textContent, "x");
  assert.equal(gateway.islandRequests().length, 0);
  await unmount();
});
