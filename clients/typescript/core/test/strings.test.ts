// Strings (spec §4.7): plural rules, templates, and an island's typed `t`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { pluralCases, pluralRules, stringCases } from "@client-compose/conformance";
import type { IslandDescriptor, ScreenResponse } from "@client-compose/protocol";

import {
  buildStrings,
  formatString,
  type IslandProps,
  IslandRegistry,
  plan,
  pluralCategory,
  preferredLocale,
} from "../src/index.ts";
import { catalogStrings } from "../src/testing.ts";

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
  type T = { heading: string; articles: (values: { count: number }) => string; missing: string };
  const t = buildStrings<T>(
    {
      heading: [],
      articles: ["count"],
      missing: [],
    },
    { heading: "Latest articles", articles: { "#1": "{count} article", "#*": "{count} articles" } },
    rules.en,
  );
  assert.equal(t.heading, "Latest articles");
  assert.equal(t.articles({ count: 1 }), "1 article");
  assert.equal(t.articles({ count: 4 }), "4 articles");
  assert.equal(t.missing, "", "a string the composer didn't send is empty");
});

test("plan gives an island that declares strings its t, and leaves others' props alone", () => {
  const Articles: IslandDescriptor<
    { total: number },
    { heading: string; count: (v: { count: number }) => string }
  > = {
    type: "articles",
    version: 1,
    strings: { heading: [], count: ["count"] },
  };
  const Plain: IslandDescriptor<{ name: string }> = { type: "plain", version: 1 };
  const registry = new IslandRegistry<string>()
    .register(Articles, (props) => `${props.t.heading}: ${props.t.count({ count: props.total })}`)
    .register(Plain, (props) => JSON.stringify(props));
  const response: ScreenResponse = {
    protocol: 0,
    screen: "home",
    plurals: { one: "i = 1 and v = 0", few: "v = 0 and i % 10 = 2..4 and i % 100 != 12..14" },
    islands: [
      {
        key: "articles",
        type: "articles",
        version: 1,
        status: "ok",
        props: { total: 3 },
        strings: {
          heading: "Artykuły",
          count: { "#few": "{count} artykuły", "#*": "{count} artykułów" },
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
    ["Artykuły: 3 artykuły", '{"name":"Ada"}'],
  );
});

test("the language a person most wants, from a device's tags or an Accept-Language header", () => {
  assert.equal(preferredLocale(["pl-PL", "en-GB"]), "pl-PL");
  assert.equal(preferredLocale([null, "uk"]), "uk");
  assert.equal(preferredLocale("en;q=0.5, pl-PL, de;q=0.9"), "pl-PL");
  assert.equal(preferredLocale("fr;q=0, *, de;q=0.1"), "de");
  assert.equal(preferredLocale(""), "en");
  assert.equal(preferredLocale(undefined, "de"), "de");
});

interface CardWords {
  heading: (values: { name: string }) => string;
}
const CardV1: IslandDescriptor<{ name: string }, CardWords> = {
  type: "card",
  version: 1,
  strings: { heading: ["name"] },
};
const PlainV1: IslandDescriptor<{ name: string }> = { type: "plain", version: 1 };

test("an island's props, from its descriptor: with t only if it declares strings", () => {
  const card: IslandProps<typeof CardV1> = {
    name: "Ada",
    t: { heading: ({ name }) => name },
  };
  const plain: IslandProps<typeof PlainV1> = { name: "Ada" };
  // @ts-expect-error: an island with strings gets them as t.
  const missing: IslandProps<typeof CardV1> = { name: "Ada" };
  assert.equal(card.t.heading(plain), "Ada");
  assert.equal(missing.name, "Ada");
});

test("a catalog's words, as the composer would send them, for tests", () => {
  const AppStrings = { strings: { posts: ["count"] } };
  const english = catalogStrings({
    app: { posts: { "#1": "{count} post", "#*": "{count} posts" } },
    islands: { "card@1": { heading: "Hello {name}" } },
  });
  assert.equal(english.t(CardV1).heading({ name: "Ada" }), "Hello Ada");
  assert.equal(
    english.app<{ posts: (v: { count: number }) => string }>(AppStrings).posts({ count: 1 }),
    "1 post",
  );
  assert.equal(english.appStrings.locale, "en");
  assert.deepEqual(english.island("card", CardV1, { name: "Ada" }, "page:2"), {
    key: "card",
    type: "card",
    version: 1,
    status: "ok",
    props: { name: "Ada" },
    next: "page:2",
    strings: { heading: "Hello {name}" },
  });
  assert.deepEqual(english.island("plain", PlainV1, { name: "Ada" }), {
    key: "plain",
    type: "plain",
    version: 1,
    status: "ok",
    props: { name: "Ada" },
  });
});
