import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

import { type CatalogIssue, checkCatalog } from "./catalog.ts";
import {
  compareActions,
  compareAppStrings,
  compareIslands,
  type CompatIssue,
  loadActionManifestsAtRef,
  loadAppStringsAtRef,
  loadManifestsAtRef,
} from "./compat.ts";
import {
  type Action,
  type AppStrings,
  checkEntities,
  type EnumDef,
  type Island,
  loadActionManifests,
  loadAppStrings,
  loadEntities,
  loadManifests,
  loadScreenStrings,
  ManifestError,
  type ObjectDef,
} from "./manifest.ts";
import { generateGo, type GoOptions } from "./targets/go.ts";
import { generateKotlin, type KotlinOptions } from "./targets/kotlin.ts";
import { generateSwift, type SwiftOptions } from "./targets/swift.ts";
import { generateTypeScript, type TypeScriptOptions } from "./targets/typescript.ts";

export {
  compareActions,
  compareAppStrings,
  compareIslands,
  type CompatIssue,
  loadActionManifestsAtRef,
  loadAppStringsAtRef,
  loadManifestsAtRef,
} from "./compat.ts";
export {
  checkEntities,
  islandEntityPaths,
  loadActionManifests,
  loadAppStrings,
  loadEntities,
  loadManifests,
  loadScreenStrings,
  ManifestError,
  parseActionManifest,
  parseAppStrings,
  parseEntityManifest,
  parseManifest,
  parseScreenStrings,
} from "./manifest.ts";
export { generateGo, generateKotlin, generateSwift, generateTypeScript };
export { type CatalogIssue, catalogLocales, checkCatalog } from "./catalog.ts";

type OneOrMany<T> = T | T[];

/**
 * `client-compose.codegen.json`. Paths are relative to the config file. Each target may be a list,
 * e.g. to generate TypeScript into both a web app and a React Native app.
 */
export interface CodegenConfig {
  /** Directory of island manifests. Optional when the config only generates actions. */
  manifests?: string;
  /** Directory of action manifests (spec §5). Generated for every target. */
  actions?: string;
  /**
   * Directory of entity manifests (spec §2.1): what several islands show, so actions can say what
   * changed about it. Generated for the Go and TypeScript targets.
   */
  entities?: string;
  /** The app strings manifest (spec §4.7): the strings shown outside any island. */
  appStrings?: string;
  /**
   * The screen strings manifest (spec §4.7): each screen's own strings, which its composer uses
   * itself (e.g. for its meta). Generated for the Go and TypeScript targets.
   */
  screenStrings?: string;
  /** Directory of the strings catalog, one JSON file per language, checked by `codegen strings`. */
  catalog?: string;
  /** The catalog's default language, which must have every string. Default "en". */
  defaultLocale?: string;
  targets: {
    go?: OneOrMany<GoOptions & { out: string }>;
    swift?: OneOrMany<SwiftOptions & { out: string }>;
    kotlin?: OneOrMany<KotlinOptions & { out: string }>;
    typescript?: OneOrMany<TypeScriptOptions & { out: string }>;
  };
}

function list<T>(v: OneOrMany<T> | undefined): T[] {
  if (v === undefined) {
    return [];
  }
  return Array.isArray(v) ? v : [v];
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

function manifestsDirOf(configPath: string): {
  config: CodegenConfig;
  base: string;
  manifestsDir?: string;
  actionsDir?: string;
  entitiesDir?: string;
  appStringsFile?: string;
  screenStringsFile?: string;
  catalogDir?: string;
} {
  // The config file is the user's: each target checks the options it reads.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const config = JSON.parse(readFileSync(configPath, "utf8")) as CodegenConfig;
  const base = dirname(resolve(configPath));
  const dir = (d: string | undefined) => (d === undefined ? undefined : resolve(base, d));
  if (
    config.manifests === undefined &&
    config.actions === undefined &&
    config.appStrings === undefined &&
    config.screenStrings === undefined
  ) {
    throw new ManifestError(
      `${configPath}: set "manifests" (islands), "actions", "appStrings" or "screenStrings"`,
    );
  }
  return {
    config,
    base,
    manifestsDir: dir(config.manifests),
    actionsDir: dir(config.actions),
    entitiesDir: dir(config.entities),
    appStringsFile: dir(config.appStrings),
    screenStringsFile: dir(config.screenStrings),
    catalogDir: dir(config.catalog),
  };
}

/** Checks the config's strings catalog against its manifests (spec §4.7). */
export function checkStrings(configPath: string): CatalogIssue[] {
  const { config, manifestsDir, appStringsFile, screenStringsFile, catalogDir } =
    manifestsDirOf(configPath);
  if (catalogDir === undefined) {
    throw new ManifestError(`${configPath}: set "catalog", the strings catalog's directory`);
  }
  const islands = manifestsDir ? loadManifests(manifestsDir) : [];
  const app = appStringsFile ? loadAppStrings(appStringsFile) : undefined;
  const screens = screenStringsFile ? loadScreenStrings(screenStringsFile).screens : [];
  return checkCatalog(catalogDir, config.defaultLocale ?? "en", islands, app, screens);
}

/**
 * Compares a config's manifests with an earlier state, either a git ref (e.g. "origin/main") or a
 * directory of manifests, and reports changes that break apps without an island version bump.
 */
export function checkCompat(
  configPath: string,
  against: { ref: string } | { dir: string; actionsDir?: string },
): CompatIssue[] {
  const { manifestsDir, actionsDir, appStringsFile } = manifestsDirOf(configPath);
  const head = manifestsDir ? loadManifests(manifestsDir) : [];
  const headActions = actionsDir ? loadActionManifests(actionsDir) : [];
  const headApp = appStringsFile ? loadAppStrings(appStringsFile) : undefined;
  if ("dir" in against) {
    const baseActions = against.actionsDir ? loadActionManifests(against.actionsDir) : [];
    return [
      ...compareIslands(loadManifests(against.dir), head),
      ...compareActions(baseActions, headActions),
    ];
  }
  const issues: CompatIssue[] = [];
  if (manifestsDir) {
    const base = loadManifestsAtRef(manifestsDir, against.ref);
    issues.push(...base.issues, ...compareIslands(base.islands, head));
  }
  if (actionsDir) {
    const baseActions = loadActionManifestsAtRef(actionsDir, against.ref);
    issues.push(...baseActions.issues, ...compareActions(baseActions.actions, headActions));
  }
  if (appStringsFile) {
    issues.push(...compareAppStrings(loadAppStringsAtRef(appStringsFile, against.ref), headApp));
  }
  return issues;
}

export function generate(configPath: string): GeneratedFile[] {
  const { config, base, manifestsDir, actionsDir, entitiesDir, appStringsFile, screenStringsFile } =
    manifestsDirOf(configPath);
  const islands = manifestsDir ? loadManifests(manifestsDir) : [];
  const actions = actionsDir ? loadActionManifests(actionsDir) : [];
  const entities = entitiesDir ? loadEntities(entitiesDir) : [];
  checkEntities(islands, entities);
  const app: AppStrings | undefined = appStringsFile ? loadAppStrings(appStringsFile) : undefined;
  const screens = screenStringsFile ? loadScreenStrings(screenStringsFile).screens : [];
  checkFlatNames(islands, actions);

  // Must not depend on the working directory, so `--check` agrees wherever codegen ran.
  const header = [
    "Code generated by client-compose codegen. DO NOT EDIT.",
    [
      manifestsDir && `Manifests: ${relative(base, manifestsDir) || "."}`,
      actionsDir && `actions: ${relative(base, actionsDir) || "."}`,
      entitiesDir && `entities: ${relative(base, entitiesDir) || "."}`,
      appStringsFile && `app strings: ${relative(base, appStringsFile)}`,
      screenStringsFile && `screen strings: ${relative(base, screenStringsFile)}`,
      `config: ${basename(configPath)}`,
    ]
      .filter(Boolean)
      .join(", "),
  ].join("\n");

  const { go, swift, kotlin, typescript } = config.targets;
  const files: GeneratedFile[] = [];
  for (const t of list(go)) {
    files.push({
      path: resolve(base, t.out),
      contents: generateGo(
        islands,
        header,
        required(t, "package", "go"),
        actions,
        screens,
        entities,
      ),
    });
  }
  for (const t of list(swift)) {
    files.push({
      path: resolve(base, t.out),
      contents: generateSwift(islands, header, t, actions, app),
    });
  }
  for (const t of list(kotlin)) {
    files.push({
      path: resolve(base, t.out),
      contents: generateKotlin(islands, header, required(t, "package", "kotlin"), actions, app),
    });
  }
  for (const t of list(typescript)) {
    files.push({
      path: resolve(base, t.out),
      contents: generateTypeScript(islands, header, t, actions, app, screens, entities),
    });
  }
  if (files.length === 0) {
    throw new ManifestError(`${configPath}: no targets configured`);
  }
  return files;
}

/** Returns the files whose contents differ from what's on disk. */
export function stale(files: GeneratedFile[]): GeneratedFile[] {
  return files.filter((f) => !existsSync(f.path) || readFileSync(f.path, "utf8") !== f.contents);
}

export function write(files: GeneratedFile[]): void {
  for (const f of files) {
    mkdirSync(dirname(f.path), { recursive: true });
    writeFileSync(f.path, f.contents);
  }
}

function required<T extends object>(opts: T, key: keyof T & string, target: string): T {
  if (!opts[key]) {
    throw new ManifestError(`targets.${target}.${key} is required`);
  }
  return opts;
}

/** Go and TypeScript put every type in one namespace, so nested names must not collide. */
function checkFlatNames(islands: Island[], actions: Action[]): void {
  const seen = new Map<string, string>();
  const visit = (def: ObjectDef | EnumDef, owner: string) => {
    const name = def.path.join("");
    if (seen.has(name)) {
      throw new ManifestError(
        `type name ${name} is generated by both ${seen.get(name)} and ${owner}; set "title" to rename one`,
      );
    }
    seen.set(name, owner);
    if (def.kind === "object") {
      for (const child of def.children) {
        visit(child, owner);
      }
    }
  };
  for (const island of islands) {
    visit(island.props, `${island.type}@${island.version}`);
  }
  for (const action of actions) {
    const owner = `action ${action.action}@${action.version}`;
    // The TypeScript descriptor and error union are named after the action itself.
    for (const name of [
      action.input.path.slice(0, -1).join(""),
      `${action.input.path.slice(0, -1).join("")}Error`,
    ]) {
      if (seen.has(name)) {
        throw new ManifestError(
          `type name ${name} is generated by both ${seen.get(name)} and ${owner}`,
        );
      }
      seen.set(name, owner);
    }
    visit(action.input, owner);
    visit(action.result, owner);
    for (const e of action.errors) {
      visit(
        e.details ?? {
          kind: "object",
          path: e.path,
          fields: [],
          children: [],
          schemas: {},
        },
        owner,
      );
    }
  }
}
