// Strings (spec §4.7): plural rules, templates, and an island's typed `t`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { pluralCases, pluralRules, stringCases } from "@client-compose/conformance";
import type { IslandDescriptor, ScreenResponse } from "@client-compose/protocol";

import { buildStrings, formatString, IslandRegistry, plan, pluralCategory } from "../src/index.ts";

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

test("plan gives an island that declares strings its t, and leaves others' props alone", () => {
  const Recipes: IslandDescriptor<
    { total: number },
    { heading: string; count: (v: { count: number }) => string }
  > = {
    type: "recipes",
    version: 1,
    strings: { heading: [], count: ["count"] },
  };
  const Plain: IslandDescriptor<{ name: string }> = { type: "plain", version: 1 };
  const registry = new IslandRegistry<string>()
    .register(Recipes, (props) => `${props.t.heading}: ${props.t.count({ count: props.total })}`)
    .register(Plain, (props) => JSON.stringify(props));
  const response: ScreenResponse = {
    protocol: 0,
    screen: "home",
    plurals: { one: "i = 1 and v = 0", few: "v = 0 and i % 10 = 2..4 and i % 100 != 12..14" },
    islands: [
      {
        key: "recipes",
        type: "recipes",
        version: 1,
        status: "ok",
        props: { total: 3 },
        strings: {
          heading: "Przepisy",
          count: { "#few": "{count} przepisy", "#*": "{count} przepisów" },
        },
      },
      {
        key: "plain",
        type: "plain",
        version: 1,
        status: "ok",
        props: { name: "Ada" },
      },
    ],
  };
  assert.deepEqual(
    plan(registry, response).map((island) => island.render()),
    ["Przepisy: 3 przepisy", '{"name":"Ada"}'],
  );
});
