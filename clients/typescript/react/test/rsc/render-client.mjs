// Runs without react-server: decodes the RSC payload from stdin and server-renders it to HTML, as a
// framework does for the first page load. Prints JSON: { html, errors }.
import { prerenderToNodeStream } from "react-dom/static";
import { createFromNodeStream } from "react-server-dom-webpack/client.node";

const clientModuleUrls = [
  new URL("../../dist/client.js", import.meta.url).href,
  new URL("../../dist/pages.js", import.meta.url).href,
  new URL("../../dist/provider.js", import.meta.url).href,
  new URL("../../dist/rendered.js", import.meta.url).href,
  new URL("../../dist/strings.js", import.meta.url).href,
  new URL("./counter.mjs", import.meta.url).href,
  new URL("./greeting.mjs", import.meta.url).href,
];
const modules = {};
for (const url of clientModuleUrls) {
  modules[url] = await import(url);
}
globalThis.__webpack_require__ = (id) => modules[id];
globalThis.__webpack_chunk_load__ = () => Promise.resolve();

const moduleMap = new Proxy(
  {},
  {
    get: (_, id) =>
      new Proxy(
        {},
        {
          get: (_, name) => ({
            id,
            chunks: [],
            name,
          }),
        },
      ),
  },
);

const tree = createFromNodeStream(process.stdin, {
  moduleMap,
  serverModuleMap: null,
  moduleLoading: null,
});
const errors = [];
const { prelude } = await prerenderToNodeStream(await tree, {
  onError: (e) => errors.push(String(e?.message ?? e)),
});
let html = "";
for await (const chunk of prelude) {
  html += chunk;
}
process.stdout.write(JSON.stringify({ html, errors }));
