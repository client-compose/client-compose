// Strings (spec §4.7): each island's words in the client's language, and the app's at /strings.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
  createComposer,
  island,
  type IslandDescriptor,
  loadCatalog,
  pagedIsland,
  place,
  screen,
  type ScreenStringsDescriptor,
  stringsFor,
  UnauthenticatedError,
} from "../src/index.ts";
import { testComposer } from "../src/testing.ts";

const ListV1: IslandDescriptor<{ items: number[] }> = { type: "list", version: 1 };
const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };

const catalog = loadCatalog(join(import.meta.dirname, "fixtures", "strings"));

function composer(options: { signedIn?: boolean } = {}) {
  return createComposer({
    screens: [
      screen("numbers", {
        islands: [
          place(
            "header",
            island(HeaderV1, () => ({ name: "Numbers" })),
          ),
          place(
            "list",
            pagedIsland(ListV1, ({ cursor }) =>
              cursor === undefined
                ? { props: { items: [1] }, next: "1" }
                : { props: { items: [2] } },
            ),
          ),
        ],
      }),
    ],
    context: () => {
      if (options.signedIn === false) {
        throw new UnauthenticatedError();
      }
    },
    strings: { catalog },
  });
}

test("a catalog is one file per language", () => {
  assert.deepEqual(Object.keys(catalog).sort(), ["en", "pl", "pt-BR"]);
  assert.deepEqual(catalog.pl?.islands?.["list@1"]?.heading, "Liczby");
});

test("each island's entry carries its strings, and the head its language and plural rules", async () => {
  const app = testComposer(composer(), {
    client: {
      platform: "test",
      appVersion: "1",
      locale: "pl-PL",
    },
  });
  const numbers = await app.screen("numbers");
  assert.equal(numbers.head?.locale, "pl");
  assert.equal(numbers.head?.plurals?.few, "v = 0 and i % 10 = 2..4 and i % 100 != 12..14");
  const list = numbers.island("list");
  assert.deepEqual(list?.status === "ok" && list.strings, {
    heading: "Liczby",
    count: {
      "#1": "Jedna liczba",
      "#few": "{count} liczby",
      "#*": "{count} liczb",
    },
  });
  // An island with no strings in the catalog has none.
  assert.equal(JSON.stringify(numbers.island("header")).includes("strings"), false);
});

test("a page has no strings; the island resolved again without a cursor has them", async () => {
  const app = testComposer(composer(), {
    client: {
      platform: "test",
      appVersion: "1",
      locale: "pl",
    },
  });
  const numbers = await app.screen("numbers");
  const page = await app.nextPage(numbers, "list");
  assert.equal(page.status, 200);
  assert.equal(JSON.stringify(page.entry).includes("strings"), false);

  const again = await app.island("numbers", {}, "list", 1);
  assert.deepEqual(again.entry?.status === "ok" && again.entry.strings?.heading, "Liczby");
});

test("a language falls back to its base language, then the default, string by string", () => {
  const brazil = stringsFor({ catalog }, "pt-BR");
  assert.equal(brazil.locale, "pt-BR");
  assert.equal(brazil.plurals.one, "i = 0..1");
  assert.deepEqual(brazil.app(), { loading: "Carregando", retry: "Try again" });
  // pt-BR has no island strings: they're the default's.
  assert.equal(brazil.island("list", 1)?.heading, "Numbers");

  const polish = stringsFor({ catalog }, "pl_PL");
  assert.equal(polish.locale, "pl");
  assert.deepEqual(polish.app(), { loading: "Ładowanie", retry: "Try again" });

  // Plural rules are the language's own where CLDR has them: European Portuguese's differ.
  assert.equal(stringsFor({ catalog: { "pt-PT": {} } }, "pt-PT").plurals.one, "i = 1 and v = 0");
  assert.equal(stringsFor({ catalog: { pt: {} } }, "pt-PT").plurals.one, "i = 0..1");

  const unknown = stringsFor({ catalog }, "xx");
  assert.equal(unknown.locale, "en");
  assert.deepEqual(unknown.plurals, { one: "i = 1 and v = 0" });
  assert.equal(stringsFor({ catalog }, undefined).locale, "en");
  assert.equal(stringsFor({ catalog, defaultLocale: "pl" }, "xx").locale, "pl");
});

test("the app strings answer without a session", async () => {
  const app = testComposer(composer({ signedIn: false }));
  const signedOut = await app.screen("numbers");
  assert.equal(signedOut.status, 401);

  const strings = await app.strings({ locale: "pl" });
  assert.equal(strings.status, 200);
  assert.deepEqual(strings.response, {
    protocol: 0,
    locale: "pl",
    plurals: stringsFor({ catalog }, "pl").plurals,
    strings: { loading: "Ładowanie", retry: "Try again" },
  });
});

test("without a catalog, entries have no strings and /strings answers 404", async () => {
  const app = testComposer(
    createComposer({
      screens: [
        screen("one", {
          islands: [
            place(
              "header",
              island(HeaderV1, () => ({ name: "" })),
            ),
          ],
        }),
      ],
    }),
  );
  const one = await app.screen("one");
  assert.equal(one.head?.locale, undefined);
  assert.equal(JSON.stringify(one.head).includes("plurals"), false);
  const strings = await app.strings();
  assert.equal(strings.status, 404);
  assert.equal(strings.error, "no_strings");
});

test("a strings request that isn't one answers 400", async () => {
  const app = composer();
  const bad = await app.handle("/strings", "{}", new Request("https://composer.test/strings"));
  assert.equal(bad?.status, 400);
  const old = await app.handle(
    "/api/strings",
    JSON.stringify({ protocol: 99, client: { platform: "test", appVersion: "1" } }),
    new Request("https://composer.test/api/strings"),
  );
  assert.equal(old?.status, 400);
  assert.match(String(old?.body), /unsupported_protocol/);
});

test("a screen reads its own strings, typed by their descriptor", async () => {
  // As codegen generates it.
  const NumbersScreenStrings: ScreenStringsDescriptor<{
    title: (values: { name: string | number }) => string;
    description: (values: { count: number }) => string;
  }> = { screen: "numbers", strings: { title: ["name"], description: ["count"] } };
  const withMeta = (strings?: { catalog: typeof catalog }) =>
    testComposer(
      createComposer({
        screens: [
          screen("numbers", {
            islands: [
              place(
                "header",
                island(HeaderV1, () => ({ name: "" })),
              ),
            ],
            meta: (lc) => {
              const t = lc.strings(NumbersScreenStrings);
              return { title: t.title({ name: "Ada" }), description: t.description({ count: 3 }) };
            },
          }),
        ],
        strings,
      }),
      {
        client: {
          platform: "test",
          appVersion: "1",
          locale: "pl",
        },
      },
    );
  // Polish has the title; its description falls back to English's.
  const polish = await withMeta({ catalog }).screen("numbers");
  assert.deepEqual(polish.head?.meta, { title: "Liczby o Ada", description: "3 numbers" });
  const without = await withMeta().screen("numbers");
  assert.equal(without.head?.meta, undefined);
});
