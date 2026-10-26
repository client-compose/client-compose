// Runs with --conditions react-server and the RSC loader: renders <ComposedScreen> from the built
// "@client-compose/react/server" entry and writes the RSC payload to stdout.
import { createElement } from "react";
import { renderToPipeableStream } from "react-server-dom-webpack/server";

import { ComposedScreen } from "../../dist/server.js";
import { registry } from "./islands.mjs";

const response = {
  protocol: 0,
  screen: "profile",
  islands: [
    {
      key: "header",
      type: "header",
      version: 1,
      status: "ok",
      props: { name: "Ada" },
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
  ],
};

// "preloaded": the page passes a response it already loaded, so the component must not fetch.
const preloaded = process.argv[2] === "preloaded";
// "streaming": the counter is pending in the stream's head, and arrives a moment later.
const streaming = process.argv[2] === "streaming";

/** The composer's stream: the head at once, then (streaming) the counter after 30ms, and the end. */
function streamed() {
  const encoder = new TextEncoder();
  const line = (l) => encoder.encode(`${JSON.stringify(l)}\n`);
  const counter = response.islands.find((e) => e.key === "counter");
  const islands = streaming
    ? response.islands.map((e) =>
        e.key === "counter"
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
      if (streaming) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        controller.enqueue(line({ kind: "island", island: counter }));
      }
      controller.enqueue(line({ kind: "end" }));
      controller.close();
    },
  });
}

const config = {
  registry,
  baseUrl: "https://composer.test",
  client: { platform: "web", appVersion: "1.0.0" },
  fetch: preloaded
    ? async () => {
        throw new Error("fetched although a response was passed in");
      }
    : async () => new Response(streamed(), { headers: { "content-type": "application/jsonl" } }),
};

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
  createElement(ComposedScreen, {
    config,
    screen: "profile",
    fallback: "loading",
    response: preloaded ? Promise.resolve(response) : undefined,
  }),
);
renderToPipeableStream(element, clientManifest, { onError: () => {} }).pipe(process.stdout);
