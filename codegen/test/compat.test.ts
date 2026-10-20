import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCompat, compareActions, compareIslands, parseActionManifest, parseManifest } from "../src/index.ts";

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
    mkdirSync(join(repo, "actions"));
    const manifest = (props: object, required: string[]) =>
      JSON.stringify({ type: "card", version: 1, props: { type: "object", required, properties: props } });
    const actionManifest = (required: string[]) =>
      JSON.stringify({ action: "rename", version: 1, input: obj({ name: str }, required), result: obj() });
    writeFileSync(join(repo, "client-compose.codegen.json"), JSON.stringify({ manifests: "islands", actions: "actions", targets: {} }));
    writeFileSync(join(repo, "islands", "card.v1.json"), manifest({ title: str }, ["title"]));
    writeFileSync(join(repo, "actions", "rename.v1.json"), actionManifest([]));
    git("add", "-A");
    git("commit", "-q", "-m", "base");

    writeFileSync(join(repo, "islands", "card.v1.json"), manifest({ title: str, subtitle: str }, ["title", "subtitle"]));
    writeFileSync(join(repo, "actions", "rename.v1.json"), actionManifest(["name"]));
    const config = join(repo, "client-compose.codegen.json");
    assert.deepEqual(
      checkCompat(config, { ref: "main" }).map((i) => `${i.island} ${i.path}`),
      ["card v1 props.subtitle", "action rename v1 input.name"],
    );
    assert.throws(() => checkCompat(config, { ref: "no-such-ref" }), /can't read git ref "no-such-ref"/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

const obj = (properties: object = {}, required: string[] = []) => ({ type: "object", required, properties });
const action = (m: Record<string, unknown> = {}, version = 1) =>
  parseActionManifest({ action: "rename", version, input: obj(), result: obj(), ...m }, "rename.json");
const actionIssues = (before: ReturnType<typeof action>, after: ReturnType<typeof action>) =>
  compareActions([before], [after]).map((i) => `${i.severity} ${i.island} ${i.path}: ${i.message.split(":")[0]}`);

test("actions: input, result and error details follow the island rules", () => {
  assert.deepEqual(actionIssues(action({ input: obj({ a: str }) }), action({ input: obj({ a: str, b: str }) })), []);
  assert.deepEqual(actionIssues(action({ input: obj({ a: str }, ["a"]) }), action({ input: obj({ a: str }) })), [
    "breaking action rename v1 input.a: became optional",
  ]);
  assert.deepEqual(actionIssues(action({ result: obj({ a: str }) }), action({ result: obj({ a: { type: "integer" } }) })), [
    "breaking action rename v1 result.a: type changed from string to integer",
  ]);
  const details = (properties: object, required: string[] = []) => ({ errors: { taken: { details: obj(properties, required) } } });
  assert.deepEqual(actionIssues(action(details({ a: str })), action(details({}, []))), []);
  assert.deepEqual(actionIssues(action(details({})), action(details({ a: str }, ["a"]))), [
    "breaking action rename v1 errors.taken.details.a: required property added",
  ]);
});

test("actions: error codes may come and go, but details may not appear or disappear", () => {
  assert.deepEqual(actionIssues(action({ errors: { a: {} } }), action({ errors: { b: {} } })), []);
  assert.deepEqual(actionIssues(action({ errors: { a: {} } }), action({ errors: { a: { details: obj() } } })), [
    "breaking action rename v1 errors.a.details: details added",
  ]);
  assert.deepEqual(actionIssues(action({ errors: { a: { details: obj() } } }), action({ errors: { a: {} } })), [
    "breaking action rename v1 errors.a.details: details removed",
  ]);
});

test("actions: removing a version warns", () => {
  assert.deepEqual(
    compareActions([action()], [action({}, 2)]).map((i) => `${i.severity} ${i.island}`),
    ["warning action rename v1"],
  );
});
