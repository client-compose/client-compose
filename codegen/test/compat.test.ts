import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCompat, compareIslands, parseManifest } from "../src/index.ts";

const island = (properties: object, required: string[] = [], version = 1) =>
  parseManifest({ type: "card", version, props: { type: "object", required, properties } }, "card.json");

/** "path: message-prefix" for each breaking issue, to keep assertions readable. */
const breaking = (before: ReturnType<typeof island>, after: ReturnType<typeof island>) =>
  compareIslands([before], [after])
    .filter((i) => i.severity === "breaking")
    .map((i) => `${i.path}: ${i.message.split(":")[0]}`);

const str = { type: "string" };

test("allows adding an optional property and removing an optional one", () => {
  assert.deepEqual(breaking(island({ a: str, b: str }, ["a"]), island({ a: str, c: str }, ["a"])), []);
});

test("allows description and title changes and enum reordering", () => {
  const before = island({ size: { type: "string", enum: ["s", "m"] } });
  const after = island({ size: { type: "string", enum: ["m", "s"], title: "Size", description: "How big" } });
  assert.deepEqual(breaking(before, after), []);
});

test("flags required properties being added or removed", () => {
  assert.deepEqual(breaking(island({ a: str }, ["a"]), island({}, [])), ["props.a: required property removed"]);
  assert.deepEqual(breaking(island({}), island({ a: str }, ["a"])), ["props.a: required property added"]);
});

test("flags changes to whether a property is required", () => {
  assert.deepEqual(breaking(island({ a: str }, ["a"]), island({ a: str })), ["props.a: became optional"]);
  assert.deepEqual(breaking(island({ a: str }), island({ a: str }, ["a"])), ["props.a: became required"]);
});

test("flags type, format and integer-size changes", () => {
  assert.deepEqual(breaking(island({ a: str }), island({ a: { type: "integer" } })), [
    "props.a: type changed from string to integer",
  ]);
  assert.deepEqual(breaking(island({ a: str }), island({ a: { type: "string", format: "uri" } })), [
    "props.a: format changed from string to string (uri)",
  ]);
  assert.deepEqual(breaking(island({ a: { type: "integer" } }), island({ a: { type: "integer", format: "int64" } })), [
    "props.a: integer size changed from integer to integer (int64)",
  ]);
});

test("flags any enum value being added or removed", () => {
  const sizes = (...values: string[]) => island({ size: { type: "string", enum: values } });
  assert.deepEqual(breaking(sizes("s", "m"), sizes("s", "m", "l")), ['props.size: enum value added ("l")']);
  assert.deepEqual(breaking(sizes("s", "m"), sizes("s")), ['props.size: enum value removed ("m")']);
});

test("recurses into nested objects, array items and map values", () => {
  const before = island({
    author: { type: "object", required: ["name"], properties: { name: str } },
    posts: { type: "array", items: { type: "object", required: ["id"], properties: { id: str } } },
    scores: { type: "object", additionalProperties: { type: "integer" } },
  });
  const after = island({
    author: { type: "object", properties: { name: str } },
    posts: { type: "array", items: { type: "object", properties: { id: str, url: str }, required: ["id", "url"] } },
    scores: { type: "object", additionalProperties: { type: "number" } },
  });
  assert.deepEqual(breaking(before, after), [
    "props.author.name: became optional",
    "props.posts[].url: required property added",
    "props.scores{}: type changed from integer to number",
  ]);
});

test("a new version is never compared with the old one", () => {
  assert.deepEqual(compareIslands([island({ a: str }, ["a"])], [island({ a: str }, ["a"]), island({}, [], 2)]), []);
});

test("warns, without failing, when an island version is removed", () => {
  const issues = compareIslands([island({}), island({}, [], 2)], [island({}, [], 2)]);
  assert.deepEqual(issues.map((i) => [i.severity, i.island]), [["warning", "card v1"]]);
});

test("compares against a git ref", () => {
  const repo = mkdtempSync(join(tmpdir(), "codegen-compat-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    mkdirSync(join(repo, "islands"));
    const manifest = (props: object, required: string[]) =>
      JSON.stringify({ type: "card", version: 1, props: { type: "object", required, properties: props } });
    writeFileSync(join(repo, "client-compose.codegen.json"), JSON.stringify({ manifests: "islands", targets: {} }));
    writeFileSync(join(repo, "islands", "card.v1.json"), manifest({ title: str }, ["title"]));
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    writeFileSync(join(repo, "islands", "card.v1.json"), manifest({ title: str, subtitle: str }, ["title", "subtitle"]));
    const config = join(repo, "client-compose.codegen.json");
    assert.deepEqual(
      checkCompat(config, { ref: "main" }).map((i) => i.path),
      ["props.subtitle"],
    );
    assert.throws(() => checkCompat(config, { ref: "no-such-ref" }), /can't read git ref "no-such-ref"/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
