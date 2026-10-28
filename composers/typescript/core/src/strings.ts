// The composer's words (spec §4.7): a catalog of one file per language, from which each island
// gets its strings, and the app its app strings, in the client's language.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildStrings,
  type PluralRules,
  type ScreenStringsDescriptor,
  type Strings,
} from "@client-compose/protocol";

import { isRecord } from "./guards.ts";
import { pluralRules } from "./plurals.generated.ts";

/**
 * One language's words: its app strings, each island version's (by `type@version`), and each
 * screen's own (by screen id).
 */
export interface CatalogFile {
  app?: Strings;
  islands?: Record<string, Strings>;
  screens?: Record<string, Strings>;
}

/** The words in every language, by language tag (`en`, `pl`, `pt-BR`). */
export type Catalog = Record<string, CatalogFile>;

export interface StringsConfig {
  catalog: Catalog;
  /** The language with every string, used when the client's isn't in the catalog. Default "en". */
  defaultLocale?: string;
}

/** The strings in one language, as the composer answers a request with them. */
export interface LocaleStrings {
  /** The language answered in: the client's, the nearest the catalog has, or the default. */
  locale: string;
  plurals: PluralRules;
  /** An island version's strings, each from the nearest language that has it. */
  island(type: string, version: number): Strings | undefined;
  /** The app strings, each from the nearest language that has it. */
  app(): Strings;
  /** A screen's own strings, each from the nearest language that has it. */
  screen(id: string): Strings | undefined;
  /**
   * A screen's own strings, typed by their generated descriptor, for words the composer sends
   * outside any request, such as an email or a notification:
   * `stringsFor(config, locale).strings(InviteScreenStrings).subject({ name })`.
   */
  strings<S>(descriptor: ScreenStringsDescriptor<S>): S;
}

/** A catalog from a directory of `<locale>.json` files. */
export function loadCatalog(dir: string): Catalog {
  const catalog: Catalog = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (!isRecord(parsed)) {
      throw new Error(`${join(dir, file)}: a catalog file is an object with "app" and "islands"`);
    }
    catalog[file.slice(0, -".json".length)] = {
      app: strings(parsed.app),
      islands: byId(parsed.islands),
      screens: byId(parsed.screens),
    };
  }
  return catalog;
}

function byId(value: unknown): Record<string, Strings> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value).map(([id, words]) => [id, strings(words) ?? {}]));
}

function strings(value: unknown): Strings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Strings = {};
  for (const [key, template] of Object.entries(value)) {
    if (typeof template === "string") {
      out[key] = template;
    } else if (isRecord(template)) {
      out[key] = Object.fromEntries(
        Object.entries(template).filter((e): e is [string, string] => typeof e[1] === "string"),
      );
    }
  }
  return out;
}

/** The catalog's strings in the language nearest the client's `locale`. */
export function stringsFor(config: StringsConfig, locale: string | undefined): LocaleStrings {
  const fallback = config.defaultLocale ?? "en";
  const chain = nearest(config.catalog, locale, fallback);
  const files = chain.map((tag) => config.catalog[tag]).filter((f) => f !== undefined);
  const answered = chain[0] ?? fallback;
  const merge = (pick: (file: CatalogFile) => Strings | undefined): Strings | undefined => {
    const found = files.map(pick).filter((s) => s !== undefined);
    if (found.length === 0) {
      return undefined;
    }
    // Nearest last, so its words win.
    return Object.assign({}, ...found.reverse());
  };
  const plurals = rulesFor(answered);
  const screen = (id: string) => merge((file) => file.screens?.[id]);
  return {
    locale: answered,
    plurals,
    island: (type, version) => merge((file) => file.islands?.[`${type}@${version}`]),
    app: () => merge((file) => file.app) ?? {},
    screen,
    strings: (descriptor) => buildStrings(descriptor.strings, screen(descriptor.screen), plurals),
  };
}

/** A screen's own strings, typed by their descriptor, from the words in the request's language. */
export function screenStrings<S>(
  words: LocaleStrings | undefined,
  descriptor: ScreenStringsDescriptor<S>,
): S {
  return buildStrings<S>(descriptor.strings, words?.screen(descriptor.screen), words?.plurals);
}

/** The languages to look in, nearest first: `pl-PL`, then `pl`, then the default. */
function nearest(catalog: Catalog, locale: string | undefined, fallback: string): string[] {
  const chain = [...tagAndParents(locale ?? ""), fallback].filter((tag) => tag in catalog);
  return [...new Set(chain)];
}

/** A language tag, then each shorter one: `zh-Hant-TW`, `zh-Hant`, `zh`. */
function tagAndParents(locale: string): string[] {
  const parts = locale
    .replaceAll("_", "-")
    .split("-")
    .filter((part) => part !== "");
  return parts.map((_, i) => parts.slice(0, parts.length - i).join("-"));
}

/** A language's plural rules: its own (`pt-PT`), or its nearest parent's (`pt`). */
function rulesFor(locale: string): PluralRules {
  for (const tag of tagAndParents(locale)) {
    const rules = pluralRules[tag];
    if (rules !== undefined) {
      return rules;
    }
  }
  return {};
}
