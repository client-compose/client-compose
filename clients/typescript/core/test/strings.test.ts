// Strings (spec §4.7): plural rules, templates, and an island's typed `t`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { pluralCases, pluralRules, stringCases } from "@client-compose/conformance";

import { buildStrings, formatString, pluralCategory } from "../src/index.ts";

const rules = pluralRules();

test("every language's plural rules put CLDR's own samples in their categories", () => {
  const wrong: string[] = [];
  for (const [language, categories] of Object.entries(pluralCases())) {
    for (const [category, counts] of Object.entries(categories)) {
      for (const count of counts) {
        const got = pluralCategory(rules[language], count);
        if (got !== category) {
          wrong.push(`${language} ${count}: ${got}, want ${category}`);
        }
      }
    }
  }
  assert.deepEqual(wrong, []);
});

for (const c of stringCases()) {
  test(`string: ${c.name}`, () => {
    assert.equal(formatString(c.template, c.values, rules[c.language]), c.expect);
  });
}

test("an island's strings become its t: text, or functions of their params", () => {
  type T = { heading: string; recipes: (values: { count: number }) => string; missing: string };
  const t = buildStrings<T>(
    {
      heading: [],
      recipes: ["count"],
      missing: [],
    },
    { heading: "Latest recipes", recipes: { "#1": "{count} recipe", "#*": "{count} recipes" } },
    rules.en,
  );
  assert.equal(t.heading, "Latest recipes");
  assert.equal(t.recipes({ count: 1 }), "1 recipe");
  assert.equal(t.recipes({ count: 4 }), "4 recipes");
  assert.equal(t.missing, "", "a string the composer didn't send is empty");
});
