import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkCompat,
  checkEntities,
  generate,
  parseActionManifest,
  parseEntityManifest,
  parseManifest,
  parseTypeManifest,
  SharedTypes,
} from "../src/index.ts";

/** Shared types from their manifests' schemas, by name. */
const typesOf = (schemas: Record<string, object>) =>
  new SharedTypes(
    Object.entries(schemas).map(([type, schema]) =>
      parseTypeManifest({ type, schema }, `types/${type}.json`),
    ),
  );

const tone = { type: "string", enum: ["warm", "cool"] };
const badge = {
  type: "object",
  required: ["label"],
  properties: { label: { type: "string" }, tone: { $ref: "tone" } },
};

/** An island whose props are `properties`, read with `types`. */
const card = (properties: object, types = typesOf({ tone, badge })) =>
  parseManifest(
    {
      type: "card",
      version: 1,
      props: { type: "object", properties },
    },
    "card.json",
    types,
  );

test("a reference is its shared type: one definition, wherever it's used", () => {
  const types = typesOf({ tone, badge });
  const island = card({ badge: { $ref: "badge", description: "Shown beside the title." } }, types);
  const [field] = island.props.fields;
  assert.equal(field?.description, "Shown beside the title.");
  assert.equal(field?.type.kind, "object");
  // The shared type is generated once, under its own name, not as the island's child.
  assert.deepEqual(field?.type.kind === "object" && field.type.def.path, ["Badge"]);
  assert.deepEqual(island.props.children, []);

  const other = card({ badge: { $ref: "badge" } }, types);
  assert.equal(
    field?.type.kind === "object" && field.type.def,
    other.props.fields[0]?.type.kind === "object" && other.props.fields[0].type.def,
  );
});

test("references are refused when they're not what they stand for", () => {
  const rejects = (properties: object, message: RegExp, types?: SharedTypes) =>
    assert.throws(() => card(properties, types), message);

  rejects({ a: { $ref: "nothing" } }, /props\.a: no shared type "nothing"/);
  rejects({ a: { $ref: "tone" } }, /set "types" in the codegen config/, SharedTypes.none);
  rejects(
    { a: { $ref: "tone", type: "string" } },
    /only annotations may sit beside it, not "type"/,
  );
  rejects({ a: { $ref: "Tone" } }, /names a shared type, in kebab-case/);
  rejects(
    { a: { $ref: "loop" } },
    /type loop refers to itself/,
    typesOf({ loop: { type: "object", properties: { next: { $ref: "loop" } } } }),
  );
  rejects(
    { a: { $ref: "list" } },
    /a shared type is an object or a string enum/,
    typesOf({ list: { type: "array", items: { type: "string" } } }),
  );
  assert.throws(
    () =>
      new SharedTypes(
        [tone, tone].map((schema) => parseTypeManifest({ type: "tone", schema }, "t.json")),
      ),
    /type tone is also defined in t\.json/,
  );
  assert.throws(
    () =>
      parseTypeManifest(
        {
          type: "tone",
          schema: tone,
          extra: 1,
        },
        "t.json",
      ),
    /unknown field "extra"/,
  );
});

test("composers validate inputs against the type written out, not the reference", () => {
  const action = parseActionManifest(
    {
      action: "set-tone",
      version: 1,
      input: {
        type: "object",
        required: ["tone"],
        properties: { tone: { $ref: "tone", description: "The new tone." } },
      },
      result: { type: "object" },
    },
    "set-tone.json",
    typesOf({ tone }),
  );
  assert.deepEqual(action.inputSchema, {
    type: "object",
    required: ["tone"],
    properties: { tone: { type: "string", enum: ["warm", "cool"] } },
  });
});

test("an island shows an entity's property with its schema, by reference or written out", () => {
  const types = typesOf({ tone, badge });
  const entity = parseEntityManifest(
    {
      entity: "card",
      id: "id",
      properties: { id: { type: "string" }, tone: { $ref: "tone" } },
    },
    "entities/card.json",
    types,
  );
  const shows = (toneSchema: object) =>
    parseManifest(
      {
        type: "cards",
        version: 1,
        props: {
          type: "object",
          properties: {
            card: {
              type: "object",
              entity: "card",
              required: ["id"],
              properties: { id: { type: "string" }, tone: toneSchema },
            },
          },
        },
      },
      "cards.json",
      types,
    );

  checkEntities([shows({ $ref: "tone" }), shows(tone)], [entity]);
  assert.throws(
    () => checkEntities([shows({ type: "string", enum: ["warm"] })], [entity]),
    /must have card's schema for it/,
  );
});

test("a shared type's name can't be one another manifest generates", () => {
  const dir = mkdtempSync(join(tmpdir(), "codegen-types-"));
  try {
    mkdirSync(join(dir, "islands"));
    mkdirSync(join(dir, "types"));
    writeFileSync(
      join(dir, "islands", "card.v1.json"),
      JSON.stringify({
        type: "card",
        version: 1,
        props: { type: "object", properties: {} },
      }),
    );
    writeFileSync(
      join(dir, "types", "card-v1.json"),
      JSON.stringify({ type: "card-v1", schema: tone }),
    );
    writeFileSync(
      join(dir, "client-compose.codegen.json"),
      JSON.stringify({
        manifests: "islands",
        types: "types",
        targets: { typescript: { out: "out.ts" } },
      }),
    );
    assert.throws(
      () => generate(join(dir, "client-compose.codegen.json")),
      /type name CardV1 is generated by both type card-v1 and card@1/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change to a shared type is judged in every island and action that uses it", () => {
  const repo = mkdtempSync(join(tmpdir(), "codegen-types-compat-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    for (const dir of ["islands", "actions", "types"]) {
      mkdirSync(join(repo, dir));
    }
    writeFileSync(
      join(repo, "client-compose.codegen.json"),
      JSON.stringify({
        manifests: "islands",
        actions: "actions",
        types: "types",
        targets: {},
      }),
    );
    writeFileSync(
      join(repo, "islands", "card.v1.json"),
      JSON.stringify({
        type: "card",
        version: 1,
        props: {
          type: "object",
          required: ["badge"],
          properties: { badge: { $ref: "badge" } },
        },
      }),
    );
    writeFileSync(
      join(repo, "actions", "set-tone.v1.json"),
      JSON.stringify({
        action: "set-tone",
        version: 1,
        input: { type: "object", properties: { tone: { $ref: "tone" } } },
        result: { type: "object" },
      }),
    );
    const write = (toneValues: string[]) => {
      writeFileSync(
        join(repo, "types", "tone.json"),
        JSON.stringify({ type: "tone", schema: { type: "string", enum: toneValues } }),
      );
      writeFileSync(
        join(repo, "types", "badge.json"),
        JSON.stringify({ type: "badge", schema: badge }),
      );
    };
    write(["warm", "cool"]);
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    // Only the shared type changes: every island and action showing it is told.
    write(["warm", "cool", "neutral"]);
    const issues = checkCompat(join(repo, "client-compose.codegen.json"), { ref: "main" });
    assert.deepEqual(
      issues.filter((i) => i.severity === "breaking").map((i) => `${i.island} ${i.path}`),
      ["card v1 props.badge.tone", "action set-tone v1 input.tone"],
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
