import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { callAction, IslandRegistry } from "@client-compose/client";
import { action, createComposer, island } from "@client-compose/composer";

import { generate, parseActionManifest, parseManifest, stale } from "../src/index.ts";
import {
  DividerV1,
  KitchenSinkV1,
  PingV1,
  RenameThingV1,
} from "./golden/typescript/islands.generated.ts";

const config = new URL("./fixtures/client-compose.codegen.json", import.meta.url).pathname;

test("golden output is up to date", () => {
  const outdated = stale(generate(config)).map((f) => f.path);
  assert.deepEqual(
    outdated,
    [],
    "run: node codegen/cli.ts codegen/test/fixtures/client-compose.codegen.json",
  );
});

test("conformance action types are up to date", () => {
  const conformance = new URL(
    "../../conformance/composer/client-compose.codegen.json",
    import.meta.url,
  ).pathname;
  const outdated = stale(generate(conformance)).map((f) => f.path);
  assert.deepEqual(
    outdated,
    [],
    "run: node codegen/cli.ts conformance/composer/client-compose.codegen.json",
  );
});

test("generated action descriptors work end to end with the composer and client", async () => {
  const composer = createComposer({
    actions: [
      action(RenameThingV1, ({ thingId, name }) => {
        if (name === "taken") {
          return { error: { code: "name_taken", details: { suggestions: ["taken-2"] } } };
        }
        return {
          result: { thing: { id: thingId, name } },
          effects: { invalidate: [{ screen: "thing", params: { thingId } }] },
        };
      }),
      action(PingV1, () => ({ result: {} })),
    ],
  });
  // The client's fetch goes straight to the composer's fetch-standard handler.
  const fetchImpl = ((url: string, init: RequestInit) =>
    composer.fetch(new Request(`https://composer.test${url}`, init))) as typeof fetch;
  const options = {
    client: { platform: "test", appVersion: "1" },
    islands: {},
    fetch: fetchImpl,
  };

  const ok = await callAction(
    "",
    RenameThingV1,
    {
      thingId: "t1",
      name: "New",
      visibility: "public",
    },
    options,
  );
  assert.deepEqual(ok.status === "ok" && [ok.result.thing, ok.effects], [
    { id: "t1", name: "New" },
    { invalidate: [{ screen: "thing", params: { thingId: "t1" } }] },
  ]);
  const taken = await callAction("", RenameThingV1, { thingId: "t1", name: "taken" }, options);
  assert.deepEqual(
    taken.status === "error" && taken.error.code === "name_taken" && taken.error.details,
    { suggestions: ["taken-2"] },
  );
  await assert.rejects(
    callAction(
      "",
      RenameThingV1,
      {
        thingId: "t1",
        name: "x",
        visibility: "secret" as "public",
      },
      options,
    ),
    /status 400/,
  );
  assert.equal((await callAction("", PingV1, {}, options)).status, "ok");
});

test("generated TS descriptors work with the client and composer", () => {
  const sample = JSON.parse(
    readFileSync(new URL("./fixtures/kitchen-sink.sample.json", import.meta.url), "utf8"),
  ) as KitchenSinkV1;
  const registry = new IslandRegistry<string>()
    .register(KitchenSinkV1, (props) => `${props.title}:${props.author["avatar-url"]}`)
    .register(DividerV1, () => "divider");
  assert.deepEqual(registry.capabilities(), { "kitchen-sink": [1], divider: [1] });
  assert.equal(
    registry.get("kitchen-sink", 1)!(sample, {} as never),
    "Hello:https://example.com/ada.png",
  );

  const sink = island(KitchenSinkV1, () => sample);
  assert.deepEqual([sink.type, sink.version], ["kitchen-sink", 1]);
});

const rejects = (props: unknown, message: RegExp) =>
  assert.throws(
    () =>
      parseManifest(
        {
          type: "x",
          version: 1,
          props,
        },
        "x.json",
      ),
    message,
  );

test("rejects unsupported schema features rather than guessing", () => {
  rejects({ type: "object", properties: { a: { oneOf: [] } } }, /props\.a: "type" must be one of/);
  rejects({ type: "object", properties: { a: { type: ["string", "null"] } } }, /type unions/);
  rejects({ type: "object", properties: { a: { $ref: "#/x" } } }, /"type" must be one of/);
  rejects(
    { type: "object", properties: { a: { type: "string", format: "date-time" } } },
    /format "date-time"/,
  );
  rejects(
    { type: "object", properties: { a: { type: "string", pattern: "x" } } },
    /unsupported keyword "pattern"/,
  );
  rejects({ type: "object", properties: { a: { type: "array" } } }, /need an "items"/);
  rejects(
    {
      type: "object",
      required: ["b"],
      properties: {},
    },
    /unknown property "b"/,
  );
  rejects({ type: "string" }, /"props" must be a JSON Schema with "type": "object"/);
});

test("rejects nested types that would share a name", () => {
  rejects(
    {
      type: "object",
      properties: {
        a: {
          type: "object",
          title: "Thing",
          properties: {},
        },
        b: {
          type: "object",
          title: "Thing",
          properties: {},
        },
      },
    },
    /both be named Thing/,
  );
});

test("rejects bad island identity", () => {
  assert.throws(
    () =>
      parseManifest(
        {
          type: "Profile_Header",
          version: 1,
          props: { type: "object" },
        },
        "x.json",
      ),
    /kebab-case/,
  );
  assert.throws(
    () =>
      parseManifest(
        {
          type: "x",
          version: 0,
          props: { type: "object" },
        },
        "x.json",
      ),
    /positive integer/,
  );
});

const rejectsAction = (manifest: Record<string, unknown>, message: RegExp) =>
  assert.throws(
    () =>
      parseActionManifest(
        {
          action: "x",
          version: 1,
          input: { type: "object" },
          result: { type: "object" },
          ...manifest,
        },
        "x.json",
      ),
    message,
  );

test("rejects bad action manifests", () => {
  rejectsAction({ action: "DoThing" }, /"action" must be kebab-case/);
  rejectsAction({ input: undefined }, /"input" must be a JSON Schema with "type": "object"/);
  rejectsAction({ result: { type: "string" } }, /"result" must be a JSON Schema/);
  rejectsAction({ errors: { NameTaken: {} } }, /must be snake_case/);
  rejectsAction(
    { errors: { taken: { details: { type: "array", items: { type: "string" } } } } },
    /errors\.taken\.details/,
  );
  rejectsAction({ errors: { taken: { message: "x" } } }, /unknown field "message"/);
  rejectsAction({ errors: [] }, /keyed by error code/);
  rejectsAction(
    { input: { type: "object", properties: { a: { type: "string", pattern: "x" } } } },
    /input\.a: unsupported keyword "pattern"/,
  );
  rejectsAction({ effects: {} }, /unknown field "effects"/);
});

test("the embedded input schema has no annotations, but keeps properties named like them", () => {
  const action = parseActionManifest(
    {
      action: "x",
      version: 1,
      input: {
        type: "object",
        description: "dropped",
        properties: {
          title: {
            type: "string",
            title: "Dropped",
            description: "dropped",
          },
        },
      },
      result: { type: "object" },
    },
    "x.json",
  );
  assert.deepEqual(action.inputSchema, {
    type: "object",
    properties: { title: { type: "string" } },
  });
});
