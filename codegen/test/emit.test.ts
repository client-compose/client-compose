import assert from "node:assert/strict";
import { test } from "node:test";

import { emit, type Role, type Target } from "../src/emit.ts";
import {
  parseActionManifest,
  parseEntityManifest,
  parseManifest,
  parseTypeManifest,
  SharedTypes,
} from "../src/index.ts";

/** A target that lists what it's asked to render, to see what every target gets, in order. */
const listing: Target = {
  prelude: () => ["prelude"],
  appStrings: (app) => [`app strings ${app.strings.length}`],
  screenStrings: (s) => [`screen strings ${s.screen}`],
  enumeration: (def) => [`enum ${def.path.join("")}`],
  object: (def, role: Role) => [`${role.kind} ${def.path.join("")}`],
  afterChildren: (def, role) => (role.kind === "entity" ? [`after ${def.path.join("")}`] : []),
  afterAction: (action) => [`after action ${action.action}`],
  finish: (source) => source.trim(),
};

test("every target gets the same declarations, in the same order, and only renders them", () => {
  const types = new SharedTypes([
    parseTypeManifest({ type: "tone", schema: { type: "string", enum: ["warm"] } }, "tone.json"),
  ]);
  const entity = parseEntityManifest(
    {
      entity: "card",
      id: "id",
      properties: { id: { type: "string" }, size: { type: "string", enum: ["s", "l"] } },
    },
    "card.json",
    types,
  );
  const island = parseManifest(
    {
      type: "card",
      version: 1,
      props: {
        type: "object",
        properties: { tone: { $ref: "tone" }, badge: { type: "object", properties: {} } },
      },
    },
    "card.v1.json",
    types,
  );
  const action = parseActionManifest(
    {
      action: "pin",
      version: 1,
      input: { type: "object", properties: {} },
      result: { type: "object", properties: {} },
      errors: { pinned: {} },
    },
    "pin.json",
    types,
  );

  const source = emit(
    {
      islands: [island],
      actions: [action],
      entities: [entity],
      types: types.all(),
      screens: [{ screen: "home", strings: [] }],
      app: { source: "app.json", strings: [] },
      header: "",
    },
    listing,
  );

  assert.deepEqual(source.split("\n"), [
    "prelude",
    "app strings 0",
    "screen strings home",
    // Shared types first; then each entity's change (every property but the id), its nested
    // types, then what follows it.
    "enum Tone",
    "entity CardEntity",
    "enum CardEntitySize",
    "after CardEntity",
    // An island's props, then the types nested in them (not the shared type it refers to).
    "island CardV1",
    "nested CardV1Badge",
    // An action's input, result and each error (an empty type when it has no details), then it.
    "input PinV1Input",
    "result PinV1Result",
    "error PinV1Pinned",
    "after action pin",
  ]);
});
