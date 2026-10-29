// Entities (spec §2.1): what several islands show, checked against what each island shows of it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { applyChanges } from "@client-compose/protocol";

import {
  checkEntities,
  islandEntityPaths,
  parseEntityManifest,
  parseManifest,
} from "../src/index.ts";
import { ThingEntity, ThingListV1 } from "./golden/typescript/islands.generated.ts";

const thing = parseEntityManifest(
  {
    entity: "thing",
    id: "id",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      done: { type: "boolean", description: "Annotations don't count." },
    },
  },
  "thing.json",
);

/** An island showing a list of things, with these properties. */
const listOf = (properties: Record<string, unknown>, required = ["id"], entity = "thing") =>
  parseManifest(
    {
      type: "thing-list",
      version: 1,
      props: {
        type: "object",
        properties: {
          things: {
            type: "array",
            items: {
              type: "object",
              entity,
              required,
              properties,
            },
          },
        },
      },
    },
    "thing-list.v1.json",
  );

test("an island may show part of an entity, and properties of its own", () => {
  const island = listOf({
    id: { type: "string" },
    done: { type: "boolean" },
    pinned: { type: "boolean" },
  });

  checkEntities([island], [thing]);

  assert.deepEqual(islandEntityPaths(island, [thing]), [
    {
      path: ["things", "[]"],
      entity: "thing",
      id: "id",
      properties: ["id", "done"],
    },
  ]);
});

test("rejects an object that doesn't show its entity as the entity says", () => {
  assert.throws(
    () => checkEntities([listOf({ id: { type: "string" } }, ["id"], "article")], [thing]),
    /no entity "article"/,
  );
  assert.throws(
    () => checkEntities([listOf({ name: { type: "string" } }, [])], [thing]),
    /needs its id, "id", required/,
  );
  assert.throws(
    () => checkEntities([listOf({ id: { type: "string" }, done: { type: "string" } })], [thing]),
    /props\.things\[\]\.done: must have thing's schema/,
  );
});

test("rejects an entity whose id isn't one of its string properties", () => {
  assert.throws(
    () =>
      parseEntityManifest(
        {
          entity: "thing",
          id: "key",
          properties: { id: { type: "string" } },
        },
        "thing.json",
      ),
    /"id" must name one of its properties, a string/,
  );
});

test("generated descriptors carry their entities, for clients to apply changes", () => {
  assert.equal(ThingEntity.entity, "thing");
  const props = {
    things: [
      { id: "t1", name: "Old" },
      { id: "t2", name: "Other" },
    ],
    bySection: { mine: [{ id: "t1", visibility: "private" as const }] },
  };

  const { props: changed } = applyChanges(props, ThingListV1.entities ?? [], [
    {
      entity: "thing",
      id: "t1",
      set: { name: "New", visibility: "public" },
    },
  ]);

  assert.deepEqual(changed, {
    things: [
      { id: "t1", name: "New" },
      { id: "t2", name: "Other" },
    ],
    bySection: { mine: [{ id: "t1", visibility: "public" }] },
  });
});
