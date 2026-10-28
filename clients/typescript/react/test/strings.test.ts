// Strings (spec §4.7): each island's `t`, from its entry and the screen's plural rules, and the app
// strings, fetched when the app starts and kept.
import "./setup.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AppStringsDescriptor,
  IslandDescriptor,
  StringsResponse,
} from "@client-compose/protocol";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  AppStringsProvider,
  type AppStringsProviderProps,
  type ClientComposeConfig,
  ClientComposeProvider,
  ComposedScreen,
  ReactIslandRegistry,
  richText,
  type StringsCache,
  useAppStrings,
  useLocale,
  viaProxy,
} from "../src/index.ts";
import {
  createTestConfig,
  type FakeGatewayHandlers,
  island,
  pending,
  screen,
  streamedScreen,
  stringsResponse,
} from "../src/testing.ts";

// As codegen generates them.
interface RecipesStrings {
  heading: string;
  count: (values: { count: number }) => string;
}
const RecipesV1: IslandDescriptor<{ total: number }, RecipesStrings> = {
  type: "recipes",
  version: 1,
  strings: { heading: [], count: ["count"] },
};
const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };

interface AppWords {
  retry: string;
  uploaded: (values: { count: number; total: number }) => string;
}
const AppStrings: AppStringsDescriptor<AppWords> = {
  strings: { retry: [], uploaded: ["count", "total"] },
};

const polish = {
  locale: "pl",
  plurals: {
    one: "i = 1 and v = 0",
    few: "v = 0 and i % 10 = 2..4 and i % 100 != 12..14",
    many: "v = 0 and i != 1 and i % 10 = 0..1 or v = 0 and i % 10 = 5..9 or v = 0 and i % 100 = 12..14",
  },
};
const recipeWords = {
  heading: "Przepisy",
  count: {
    "#1": "{count} przepis",
    "#few": "{count} przepisy",
    "#*": "{count} przepisów",
  },
};

/** Every props object each island was rendered with, in order. */
const rendered = { recipes: [] as object[], header: [] as object[] };

const registry = new ReactIslandRegistry()
  .registerComponent(RecipesV1, (props) => {
    rendered.recipes.push(props);
    return createElement(
      "h2",
      null,
      `${props.t.heading}: ${props.t.count({ count: props.total })}`,
    );
  })
  .registerComponent(HeaderV1, (props) => {
    rendered.header.push(props);
    return createElement("h1", null, props.name);
  });

async function mount(node: ReactNode) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    html: () => container.innerHTML,
    click: (selector: string) => container.querySelector<HTMLElement>(selector)?.click(),
    unmount: () => act(async () => root.unmount()),
  };
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

function screenOf(config: ClientComposeConfig) {
  return createElement(
    ClientComposeProvider,
    { config },
    createElement(ComposedScreen, { screen: "home" }),
  );
}

test("an island's component gets its strings as t, counted by the screen's plural rules", async () => {
  for (const [total, text] of [
    [1, "1 przepis"],
    [3, "3 przepisy"],
    [5, "5 przepisów"],
    [22, "22 przepisy"],
  ] as const) {
    const { config } = createTestConfig({
      registry,
      handlers: {
        screens: {
          home: () =>
            screen(
              "home",
              [island("recipes", RecipesV1, { total }, { strings: recipeWords })],
              {},
              polish,
            ),
        },
      },
    });
    const view = await mount(screenOf(config));
    assert.equal(view.html(), `<h2>Przepisy: ${text}</h2>`);
    await view.unmount();
  }
});

test("strings the composer didn't send are empty, and islands without strings get no t", async () => {
  const { config } = createTestConfig({
    registry,
    handlers: {
      screens: {
        home: () =>
          screen("home", [
            island("header", HeaderV1, { name: "Ada" }),
            island("recipes", RecipesV1, { total: 2 }),
          ]),
      },
    },
  });
  rendered.header.length = 0;
  const view = await mount(screenOf(config));
  assert.equal(view.html(), "<h1>Ada</h1><h2>: </h2>");
  assert.deepEqual(rendered.header.at(-1), { name: "Ada" });
  await view.unmount();
});

test("an island shown while the screen streams keeps the t it was rendered with", async () => {
  const home = streamedScreen(
    "home",
    [
      island("recipes", RecipesV1, { total: 2 }, { strings: recipeWords }),
      pending("header", HeaderV1),
    ],
    {},
    polish,
  );
  const { config } = createTestConfig({ registry, handlers: { screens: { home: () => home } } });
  rendered.recipes.length = 0;
  const view = await mount(screenOf(config));
  home.send(island("header", HeaderV1, { name: "Ada" }));
  home.end();
  await settle();
  assert.equal(view.html(), "<h2>Przepisy: 2 przepisy</h2><h1>Ada</h1>");
  // The same t every time, so hooks that depend on it don't run again.
  const ts = rendered.recipes.map((props) => Reflect.get(props, "t"));
  assert.ok(ts.length >= 2);
  assert.ok(ts.every((t) => t === ts[0]));
  await view.unmount();
});

// ---- App strings ----

function Words(): ReactNode {
  const t = useAppStrings(AppStrings);
  return createElement("p", null, `${t.retry} · ${t.uploaded({ count: 2, total: 3 })}`);
}

const english = (retry = "Try again"): StringsResponse => ({
  protocol: 0,
  locale: "en",
  plurals: { one: "i = 1 and v = 0" },
  strings: { retry, uploaded: "{count} of {total} uploaded" },
});

function memoryCache(kept: Record<string, StringsResponse> = {}): StringsCache & {
  kept: Record<string, StringsResponse>;
} {
  return {
    kept,
    read: (locale) => kept[locale],
    write: (locale, response) => {
      kept[locale] = response;
    },
  };
}

async function app(
  handlers: FakeGatewayHandlers,
  props: Omit<AppStringsProviderProps, "children"> = {},
  config: Partial<ClientComposeConfig> = {},
) {
  const test = createTestConfig({
    registry,
    handlers,
    ...config,
  });
  const view = await mount(
    createElement(
      ClientComposeProvider,
      { config: test.config },
      createElement(AppStringsProvider, {
        loading: "loading",
        failed: (retry: () => void) =>
          createElement("button", { onClick: retry }, "Couldn't connect"),
        ...props,
        children: createElement(Words),
      }),
    ),
  );
  return { ...view, gateway: test.gateway };
}

test("the app waits for its strings on its first launch, then keeps them", async () => {
  const cache = memoryCache();
  let answer: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => (answer = resolve));
  const view = await app(
    {},
    { cache },
    {
      loadStrings: async () => {
        await arrived;
        return english();
      },
    },
  );
  assert.equal(view.html(), "loading");
  await act(async () => answer?.());
  await settle();
  assert.equal(view.html(), "<p>Try again · 2 of 3 uploaded</p>");
  assert.equal(cache.kept.en?.strings.retry, "Try again");
  await view.unmount();
});

test("a later launch starts with the kept strings, and refreshes them", async () => {
  const cache = memoryCache({ en: english("Retry") });
  const view = await app({ strings: () => stringsResponse("en", english().strings) }, { cache });
  await settle();
  assert.equal(view.html(), "<p>Try again · 2 of 3 uploaded</p>");
  assert.equal(cache.kept.en?.strings.retry, "Try again");
  await view.unmount();
});

test("kept strings stay when the composer can't be reached", async () => {
  const cache = memoryCache({ en: english("Retry") });
  const view = await app({ strings: () => ({ status: 503, body: {} }) }, { cache });
  await settle();
  assert.equal(view.html(), "<p>Retry · 2 of 3 uploaded</p>");
  await view.unmount();
});

test("with no strings and no composer, the app says so, and tries again when asked", async () => {
  let up = false;
  const view = await app({
    strings: () => (up ? stringsResponse("en", english().strings) : { status: 503, body: {} }),
  });
  await settle();
  assert.equal(view.html(), "<button>Couldn't connect</button>");
  up = true;
  await act(async () => view.click("button"));
  await settle();
  assert.equal(view.html(), "<p>Try again · 2 of 3 uploaded</p>");
  assert.equal(view.gateway.stringsRequests().length, 2);
  await view.unmount();
});

test("strings given up front are shown without a request", async () => {
  const view = await app({}, { initial: english() });
  assert.equal(view.html(), "<p>Try again · 2 of 3 uploaded</p>");
  assert.equal(view.gateway.stringsRequests().length, 0);
  await view.unmount();
});

test("the strings request says the client's language", async () => {
  const view = await app(
    {
      strings: () =>
        stringsResponse("pl", { retry: "Spróbuj ponownie", uploaded: "{count}/{total}" }),
    },
    {},
    {
      client: {
        platform: "web",
        appVersion: "test",
        locale: "pl-PL",
      },
    },
  );
  await settle();
  assert.equal(view.html(), "<p>Spróbuj ponownie · 2/3</p>");
  assert.equal(view.gateway.stringsRequests()[0]?.client?.locale, "pl-PL");
  await view.unmount();
});

test("through a proxy, strings come from the server's loadStrings", async () => {
  const transport = viaProxy({
    performAction: async () => ({
      ok: false,
      status: 500,
      body: "",
    }),
    loadStrings: async () => ({ ok: true, response: english() }),
  });
  const view = await app({}, {}, transport);
  await settle();
  assert.equal(view.html(), "<p>Try again · 2 of 3 uploaded</p>");
  assert.equal(view.gateway.stringsRequests().length, 0);
  await view.unmount();
});

test("richText puts nodes into a sentence, keeping it whole", async () => {
  const view = await mount(
    createElement(
      "p",
      null,
      richText("New here? {link}, or {link} later. {unknown}", {
        link: createElement("a", { href: "/sign-up" }, "Sign up"),
      }),
    ),
  );
  assert.equal(
    view.html(),
    '<p>New here? <a href="/sign-up">Sign up</a>, or <a href="/sign-up">Sign up</a> later. {unknown}</p>',
  );
  await view.unmount();
});

function Locale() {
  return createElement("p", null, useLocale());
}

test("useLocale is the language the client asks for, to format dates and numbers in", async () => {
  const { config } = createTestConfig({
    registry,
    client: {
      platform: "web",
      appVersion: "test",
      locale: "pl-PL",
    },
  });
  const view = await mount(createElement(ClientComposeProvider, { config }, createElement(Locale)));
  assert.equal(view.html(), "<p>pl-PL</p>");
  await view.unmount();
});
