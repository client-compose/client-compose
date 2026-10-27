// Strings in manifests (spec §2, §4.7): parsing, compatibility across versions, and the catalog.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkCatalog,
  compareAppStrings,
  compareIslands,
  parseAppStrings,
  parseManifest,
} from "../src/index.ts";

const island = (strings: unknown) =>
  parseManifest(
    {
      type: "card",
      version: 1,
      props: { type: "object", properties: {} },
      strings,
    },
    "card.json",
  );

test("a manifest's strings: keys, params, and whether they're counted", () => {
  assert.deepEqual(
    island({ heading: {}, items: { params: ["count"], counted: true } }).strings.map((s) => [
      s.key,
      s.params,
      s.counted,
    ]),
    [
      ["heading", [], false],
      ["items", ["count"], true],
    ],
  );
  const bad: [unknown, RegExp][] = [
    [{ Heading: {} }, /camelCase/],
    [{ heading: "Hi" }, /must be an object/],
    [{ heading: { params: ["a", "a"] } }, /twice/],
    [{ heading: { counted: true } }, /"count" param/],
    [{ heading: { words: "Hi" } }, /unknown field "words"/],
  ];
  for (const [strings, message] of bad) {
    assert.throws(() => island(strings), message);
  }
});

test("removing a string, or changing its params or counting, needs a new version", () => {
  const base = [
    island({
      a: {},
      b: { params: ["name"] },
      c: { params: ["count"], counted: true },
    }),
  ];
  const head = [
    island({
      b: { params: ["who"] },
      c: { params: ["count"] },
      d: {},
    }),
  ];
  assert.deepEqual(
    compareIslands(base, head).map((i) => [i.path, i.severity]),
    [
      ["strings.a", "breaking"],
      ["strings.b", "breaking"],
      ["strings.c", "breaking"],
    ],
  );
  const app = (strings: unknown) => parseAppStrings({ strings }, "app.json");
  assert.deepEqual(compareAppStrings(app({ a: {} }), app({ a: {}, b: {} })), []);
  assert.equal(compareAppStrings(app({ a: {} }), app({}))[0]?.path, "strings.a");
});

test("the catalog has every string in its default language, and nothing that isn't declared", () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-"));
  mkdirSync(dir, { recursive: true });
  const write = (locale: string, catalog: unknown) =>
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
  write("en", {
    app: { loading: "Loading", stray: "?" },
    islands: {
      "card@1": {
        heading: "Hi {nme}",
        items: { "#1": "{count} item" },
      },
      "card@9": {},
    },
  });
  write("pl", { islands: { "card@1": { heading: "Cześć", items: "{count} elementów" } } });
  const issues = checkCatalog(
    dir,
    "en",
    [island({ heading: { params: ["name"] }, items: { params: ["count"], counted: true } })],
    parseAppStrings({ strings: { loading: {}, retry: {} } }, "app.json"),
  );
  const got = issues.map(
    (i) => `${i.severity} ${i.file.endsWith("pl.json") ? "pl" : "en"} ${i.path}`,
  );
  assert.deepEqual(got.sort(), [
    "error en app.retry",
    "error en app.stray",
    "error en islands.card@1.heading",
    "error en islands.card@1.items",
    "error en islands.card@9",
    "warning pl app.loading",
    "warning pl app.retry",
  ]);
});
