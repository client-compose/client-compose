// Checks a strings catalog (spec §4.7) against the manifests: one JSON file per language, with the
// words for every declared string. The default language must have them all; another that lacks one
// falls back to the default's, which is worth a warning, not an error.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AppStrings, Island, ScreenStringsDef, StringDef } from "./manifest.ts";

export interface CatalogIssue {
  severity: "error" | "warning";
  /** The catalog file, e.g. "strings/pl.json". */
  file: string;
  /** Where in it, e.g. "islands.recipe-list@1.heading". */
  path: string;
  message: string;
}

const VARIANT = /^#([0-9]+|zero|one|two|few|many|other|\*)$/;
const SLOT = /\{([A-Za-z0-9]+)\}/g;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The catalog's languages, by file name: "pl.json" -> "pl". */
export function catalogLocales(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .sort();
}

export function checkCatalog(
  dir: string,
  defaultLocale: string,
  islands: Island[],
  app: AppStrings | undefined,
  screens: ScreenStringsDef[] = [],
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const locales = catalogLocales(dir);
  if (!locales.includes(defaultLocale)) {
    issues.push({
      severity: "error",
      file: join(dir, `${defaultLocale}.json`),
      path: "",
      message: `the default language's file is missing`,
    });
  }
  const declared = new Map(islands.map((i) => [`${i.type}@${i.version}`, i.strings]));
  for (const locale of locales) {
    const file = join(dir, `${locale}.json`);
    const report = (severity: CatalogIssue["severity"], path: string, message: string) =>
      issues.push({
        severity,
        file,
        path,
        message,
      });
    let catalog: unknown;
    try {
      catalog = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      report("error", "", `invalid JSON (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    if (!isRecord(catalog)) {
      report("error", "", `a catalog is an object with "app" and "islands"`);
      continue;
    }
    const missing = locale === defaultLocale ? "error" : "warning";
    checkGroup(catalog.app, app?.strings ?? [], "app", missing, report);
    const islandsByVersion = isRecord(catalog.islands) ? catalog.islands : {};
    for (const id of Object.keys(islandsByVersion)) {
      if (!declared.has(id)) {
        report("error", `islands.${id}`, "no island version with this type and version");
      }
    }
    for (const [id, strings] of declared) {
      if (strings.length > 0) {
        checkGroup(islandsByVersion[id], strings, `islands.${id}`, missing, report);
      }
    }
    const screensById = isRecord(catalog.screens) ? catalog.screens : {};
    const declaredScreens = new Map(screens.map((s) => [s.screen, s.strings]));
    for (const id of Object.keys(screensById)) {
      if (!declaredScreens.has(id)) {
        report("error", `screens.${id}`, "no screen strings declared for this screen");
      }
    }
    for (const [id, strings] of declaredScreens) {
      checkGroup(screensById[id], strings, `screens.${id}`, missing, report);
    }
  }
  return issues;
}

/** One group of strings (the app's, or an island version's) against its declarations. */
function checkGroup(
  raw: unknown,
  declared: StringDef[],
  path: string,
  missing: CatalogIssue["severity"],
  report: (severity: CatalogIssue["severity"], path: string, message: string) => void,
) {
  const words = isRecord(raw) ? raw : {};
  const byKey = new Map(declared.map((d) => [d.key, d]));
  for (const key of Object.keys(words)) {
    if (!byKey.has(key)) {
      report("error", `${path}.${key}`, "not a declared string");
    }
  }
  for (const def of declared) {
    const value = words[def.key];
    const at = `${path}.${def.key}`;
    if (value === undefined) {
      report(missing, at, "missing");
      continue;
    }
    for (const problem of templateProblems(value, def)) {
      report("error", at, problem);
    }
  }
}

function templateProblems(value: unknown, def: StringDef): string[] {
  if (typeof value === "string") {
    return slotProblems(value, def);
  }
  if (!def.counted) {
    return ["must be text: only a counted string has variants"];
  }
  if (!isRecord(value)) {
    return ["must be text, or variants by number"];
  }
  const problems: string[] = [];
  if (!("#*" in value)) {
    problems.push(`variants need "#*", for any number no other variant is for`);
  }
  for (const [key, template] of Object.entries(value)) {
    if (!VARIANT.test(key)) {
      problems.push(`${JSON.stringify(key)} isn't a variant: #<number>, #<category> or #*`);
    } else if (typeof template !== "string") {
      problems.push(`${key} must be text`);
    } else {
      problems.push(...slotProblems(template, def).map((p) => `${key}: ${p}`));
    }
  }
  return problems;
}

function slotProblems(template: string, def: StringDef): string[] {
  return [...template.matchAll(SLOT)]
    .map((m) => m[1] ?? "")
    .filter((name) => !def.params.includes(name))
    .map((name) => `{${name}} isn't one of its params (${def.params.join(", ") || "none"})`);
}
