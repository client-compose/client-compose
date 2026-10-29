// Runs with --conditions react-server and the RSC loader: renders <ComposedScreen> from the built
// "@client-compose/react/server" entry and writes the RSC payload to stdout.
import { createElement } from "react";
import { renderToPipeableStream } from "react-server-dom-webpack/server";

import { ComposedScreen, serverComposer } from "../../dist/server.js";
import { registry } from "./islands.mjs";

const response = {
  protocol: 0,
  screen: "profile",
  locale: "en",
  plurals: { one: "i = 1 and v = 0" },
  islands: [
    {
      key: "header",
      type: "header",
      version: 1,
      status: "ok",
      props: { id: "ada", name: "Ada" },
    },
    {
      key: "broken",
      type: "broken",
      version: 1,
      status: "ok",
      props: {},
    },
    {
      key: "counter",
      type: "counter",
      version: 1,
      status: "ok",
      props: { start: 1 },
    },
    {
      key: "greeting",
      type: "greeting",
      version: 1,
      status: "ok",
      props: { name: "Grace" },
      strings: { hello: "Hi {name}", posts: { "#one": "{count} post", "#*": "{count} posts" } },
    },
  ],
};

// "preloaded": the page passes a response it already loaded, so the component must not fetch.
const preloaded = process.argv[2] === "preloaded";
// "streaming": the counter is pending in the stream's head, and arrives a moment later.
// "out-of-order": the header is pending too, and arrives after the counter, below it.
const outOfOrder = process.argv[2] === "out-of-order";
const streaming = process.argv[2] === "streaming" || outOfOrder;
const late = outOfOrder ? ["counter", "header"] : ["counter"];

/** The composer's stream: the head at once, then each late island 30ms apart, and the end. */
function streamed() {
  const encoder = new TextEncoder();
  const line = (l) => encoder.encode(`${JSON.stringify(l)}\n`);
  const islands = streaming
    ? response.islands.map((e) =>
        late.includes(e.key)
          ? {
              key: e.key,
              type: e.type,
              version: e.version,
              status: "pending",
            }
          : e,
      )
    : response.islands;
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        line({
          kind: "head",
          ...response,
          islands,
        }),
      );
      for (const key of streaming ? late : []) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        const island = response.islands.find((e) => e.key === key);
        controller.enqueue(line({ kind: "island", island }));
      }
      controller.enqueue(line({ kind: "end" }));
      controller.close();
    },
  });
}

// "composer": the page asks serverComposer for the same things more than once.
const composed = process.argv[2] === "composer";
const requests = { screens: 0, strings: 0 };
const locales = [];

const config = {
  registry,
  baseUrl: "https://composer.test",
  client: { platform: "web", appVersion: "1.0.0" },
  fetch: preloaded
    ? async () => {
        throw new Error("fetched although a response was passed in");
      }
    : async (url, init) => {
        locales.push(JSON.parse(String(init.body)).client.locale);
        if (String(url).endsWith("/strings")) {
          requests.strings++;
          return Response.json({
            protocol: 0,
            locale: "pl",
            plurals: {},
            strings: { title: "Witaj" },
          });
        }
        requests.screens++;
        return new Response(streamed(), { headers: { "content-type": "application/jsonl" } });
      },
};

const composer = serverComposer(config, {
  client: async () => ({ ...config.client, locale: "pl" }),
});
const AppStrings = { strings: { title: [] } };

/** A page that asks for the screen and the app strings twice each, its params in either order. */
async function Page() {
  const stream = composer.openScreen("profile", { a: "1", b: "2" });
  await composer.openScreen("profile", { b: "2", a: "1" });
  await composer.appStrings();
  const strings = await composer.strings(AppStrings);
  return createElement(
    "div",
    null,
    createElement("h2", null, strings.title),
    createElement(
      "p",
      null,
      `screens ${requests.screens} strings ${requests.strings} in ${[...new Set(locales)].join()}`,
    ),
    createElement(ComposedScreen, {
      config,
      screen: "profile",
      stream,
    }),
  );
}

// Client references are "<file url>#<export>"; this test loads modules by URL, so map them as-is.
const clientManifest = new Proxy(
  {},
  {
    get: (_, ref) => {
      const [id, name] = String(ref).split("#");
      return {
        id,
        chunks: [],
        name,
      };
    },
  },
);

const element = createElement(
  "main",
  null,
  composed
    ? createElement(Page)
    : createElement(ComposedScreen, {
        config,
        screen: "profile",
        fallback: "loading",
        response: preloaded ? Promise.resolve(response) : undefined,
      }),
);
renderToPipeableStream(element, clientManifest, { onError: () => {} }).pipe(process.stdout);
