// Uses every published package from plain Node ESM, the way a consumer would.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { buildRequest, callAction, fetchScreen, IslandRegistry, plan } from "@client-compose/client";
import {
  conformanceActions,
  conformanceScreen,
  createActions,
  createComposer,
  defineAction,
  defineIsland,
  defineScreen,
} from "@client-compose/composer";
import { clientCases, runComposerConformance } from "@client-compose/conformance";
import { generateTypeScript, parseManifest } from "@client-compose/codegen";
import { createRequestListener } from "@client-compose/node-http";
import { PROTOCOL_VERSION } from "@client-compose/protocol";
import { ClientComposeProvider, declaredError, Island, isUnexpected, ReactIslandRegistry, viaProxy } from "@client-compose/react";
import { createComposerProxy } from "@client-compose/client/proxy";
import { actionError, createTestConfig } from "@client-compose/react/testing";

assert.equal(PROTOCOL_VERSION, 0);

// Composer conformance, through @client-compose/composer + node-http.
const greeting = { type: "greeting", version: 1 };
const screens = [
  conformanceScreen(),
  defineScreen({ id: "home", layout: () => [{ key: "hello", island: [defineIsland(greeting, () => ({ name: "Ada" }))] }] }),
];
const Greet = { action: "greet", version: 1, errors: [], input: { type: "object", required: ["name"], properties: { name: { type: "string" } } } };
const actions = createActions([...conformanceActions(), defineAction(Greet, ({ name }) => ({ result: { text: `Hi ${name}` } }))]);
const server = createServer(createRequestListener(createComposer(screens), () => null, { actions })).listen(0, "127.0.0.1");
await once(server, "listening");
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const results = await runComposerConformance(baseUrl);
assert.deepEqual(results.filter((r) => !r.passed), [], "composer conformance");
console.log(`composer conformance (screens and actions): ${results.length}/${results.length}`);

// Actions, through @client-compose/client.
const greeted = await callAction(baseUrl, Greet, { name: "Ada" }, { client: { platform: "node", appVersion: "0" } });
assert.deepEqual(greeted.result, { text: "Hi Ada" });

// Client conformance fixtures, through @client-compose/client.
const cases = clientCases().filter((c) => !c.typedOnly);
for (const c of cases) {
  const registry = new IslandRegistry();
  for (const [type, versions] of Object.entries(c.registered)) {
    for (const version of versions) registry.register(type, version, (props) => `${type}@${version}:${props.v}`);
  }
  assert.deepEqual(registry.capabilities(), c.expectCapabilities, c.name);
  const skipped = [];
  const rendered = plan(registry, c.response, {
    onError: c.renderErrors ? (e) => `error:${e.key}:${e.error.code}` : undefined,
    onSkipped: (e) => skipped.push(e.key),
  }).map((i) => i.render());
  assert.deepEqual(rendered, c.expectRendered, c.name);
  assert.deepEqual(skipped, c.expectSkipped, c.name);
}
console.log(`client conformance: ${cases.length}/${cases.length}`);

// Client -> composer round trip, then render with @client-compose/react.
const registry = new ReactIslandRegistry().registerComponent(greeting, ({ name }) => createElement("h1", null, `Hello ${name}`));
const response = await fetchScreen(baseUrl, buildRequest(registry, "home", { platform: "node", appVersion: "0.0.0" }));
const [hello] = plan(registry, response);
const html = renderToString(
  createElement(
    ClientComposeProvider,
    { config: { registry, baseUrl, client: { platform: "node", appVersion: "0.0.0" } } },
    createElement(Island, { island: hello }),
  ),
);
// Each island is isolated in its own Suspense boundary (<!--$-->…<!--/$-->).
assert.equal(html, "<!--$--><h1>Hello Ada</h1><!--/$-->");
console.log("react render:", html);
server.close();

// Testing helpers: a fake composer behind a test config.
const tested = createTestConfig({ registry, handlers: { actions: { greet: () => actionError(Greet, { code: "nope" }) } } });
const tried = await callAction(tested.config.baseUrl, Greet, { name: "Ada" }, { client: tested.config.client, fetch: tested.config.fetch });
assert.deepEqual(declaredError(tried), { code: "nope" });
assert.equal(isUnexpected(tried), true);
assert.equal(tested.gateway.actionRequests()[0].input.name, "Ada");
console.log("testing helpers: ok");

// Proxying through a server, and back in the browser.
const proxy = createComposerProxy({ baseUrl: tested.config.baseUrl, client: () => tested.config.client, fetch: tested.config.fetch });
const transport = viaProxy({ performAction: proxy.performAction });
const proxied = await transport.performAction({ protocol: 0, action: "greet", version: 1, input: { name: "Grace" }, client: { platform: "x", appVersion: "0" } });
assert.deepEqual(declaredError(proxied), { code: "nope" });
assert.deepEqual(tested.gateway.actionRequests()[1].client, tested.config.client);
console.log("proxy: ok");

// Codegen as a library.
const island = parseManifest({ type: "greeting", version: 1, props: { type: "object", required: ["name"], properties: { name: { type: "string" } } } }, "greeting.json");
assert.match(generateTypeScript([island], "test"), /export interface GreetingV1 \{\n  name: string;\n\}/);
console.log("codegen library: ok");
