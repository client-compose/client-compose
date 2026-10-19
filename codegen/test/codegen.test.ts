import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IslandRegistry } from "@client-compose/client";
import { defineIsland } from "@client-compose/composer";
import { generate, parseManifest, stale } from "../src/index.ts";
import { DividerV1, KitchenSinkV1 } from "./golden/typescript/islands.generated.ts";

const config = new URL("./fixtures/client-compose.codegen.json", import.meta.url).pathname;

test("golden output is up to date", () => {
  const outdated = stale(generate(config)).map((f) => f.path);
  assert.deepEqual(outdated, [], "run: node codegen/cli.ts codegen/test/fixtures/client-compose.codegen.json");
});

test("generated TS descriptors work with the client and composer", () => {
  const sample = JSON.parse(
    readFileSync(new URL("./fixtures/kitchen-sink.sample.json", import.meta.url), "utf8"),
  ) as KitchenSinkV1;
  const registry = new IslandRegistry<string>()
    .register(KitchenSinkV1, (props) => `${props.title}:${props.author["avatar-url"]}`)
    .register(DividerV1, () => "divider");
  assert.deepEqual(registry.capabilities(), { "kitchen-sink": [1], divider: [1] });
  assert.equal(registry.get("kitchen-sink", 1)!(sample, {} as never), "Hello:https://example.com/ada.png");

  const island = defineIsland(KitchenSinkV1, () => sample);
  assert.deepEqual([island.type, island.version], ["kitchen-sink", 1]);
});

const rejects = (props: unknown, message: RegExp) =>
  assert.throws(() => parseManifest({ type: "x", version: 1, props }, "x.json"), message);

test("rejects unsupported schema features rather than guessing", () => {
  rejects({ type: "object", properties: { a: { oneOf: [] } } }, /props\.a: "type" must be one of/);
  rejects({ type: "object", properties: { a: { type: ["string", "null"] } } }, /type unions/);
  rejects({ type: "object", properties: { a: { $ref: "#/x" } } }, /"type" must be one of/);
  rejects({ type: "object", properties: { a: { type: "string", format: "date-time" } } }, /format "date-time"/);
  rejects({ type: "object", properties: { a: { type: "string", pattern: "x" } } }, /unsupported keyword "pattern"/);
  rejects({ type: "object", properties: { a: { type: "array" } } }, /need an "items"/);
  rejects({ type: "object", required: ["b"], properties: {} }, /unknown property "b"/);
  rejects({ type: "string" }, /"props" must be a JSON Schema with "type": "object"/);
});

test("rejects nested types that would share a name", () => {
  rejects(
    {
      type: "object",
      properties: {
        a: { type: "object", title: "Thing", properties: {} },
        b: { type: "object", title: "Thing", properties: {} },
      },
    },
    /both be named Thing/,
  );
});

test("rejects bad island identity", () => {
  assert.throws(() => parseManifest({ type: "Profile_Header", version: 1, props: { type: "object" } }, "x.json"), /kebab-case/);
  assert.throws(() => parseManifest({ type: "x", version: 0, props: { type: "object" } }, "x.json"), /positive integer/);
});
