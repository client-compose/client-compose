#!/usr/bin/env node
// client-compose-codegen: generate island props types, and lint manifest changes.
// (In this repo: node codegen/cli.ts …)

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { checkCompat, generate, ManifestError, stale, write, type CompatIssue } from "./index.ts";

// Standalone binaries have the version compiled in (see scripts/build-codegen-binaries.sh).
declare const __CLIENT_COMPOSE_CODEGEN_VERSION__: string | undefined;

const USAGE = `Usage:
  client-compose-codegen <config.json>... [--check]
      Generate island props and action types for every target in each config.
      --check   write nothing; exit 1 if any generated file is out of date (for CI)

  client-compose-codegen compat <config.json>... (--base <git-ref> | --base-dir <dir>)
      Report island and action manifest changes that break apps without a version bump, compared
      with a git ref (e.g. origin/main) or a directory of island manifests. Exits 1 on breaking
      changes.

  client-compose-codegen --version | --help`;

function version(): string {
  if (typeof __CLIENT_COMPOSE_CODEGEN_VERSION__ === "string") return __CLIENT_COMPOSE_CODEGEN_VERSION__;
  return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
}

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

function runGenerate(args: string[]): boolean {
  const check = args.includes("--check");
  const configs = args.filter((a) => a !== "--check");
  if (configs.length === 0 || configs.some((c) => c.startsWith("-"))) fail("Expected one or more config files.");

  let ok = true;
  for (const config of configs) {
    try {
      const files = generate(config);
      const outdated = stale(files);
      if (check) {
        for (const f of outdated) console.error(`✖ out of date: ${relative(process.cwd(), f.path)}`);
        if (outdated.length) ok = false;
        else console.log(`✔ ${config}: ${files.length} file(s) up to date`);
      } else {
        write(outdated);
        for (const f of files) console.log(`${outdated.includes(f) ? "wrote" : "unchanged"} ${relative(process.cwd(), f.path)}`);
      }
    } catch (err) {
      if (!(err instanceof ManifestError)) throw err;
      console.error(`✖ ${err.message}`);
      ok = false;
    }
  }
  if (!ok && check) console.error("\nRun codegen without --check to update.");
  return ok;
}

function runCompat(args: string[]): boolean {
  const configs: string[] = [];
  let against: { ref: string } | { dir: string } | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base" || arg === "--base-dir") {
      const value = args[++i];
      if (!value) fail(`${arg} needs a value.`);
      against = arg === "--base" ? { ref: value } : { dir: value };
    } else if (arg.startsWith("-")) {
      fail(`Unknown option ${arg}.`);
    } else {
      configs.push(arg);
    }
  }
  if (configs.length === 0) fail("Expected one or more config files.");
  if (!against) fail("Pass --base <git-ref> or --base-dir <dir> to compare against.");
  const baseLabel = "ref" in against ? against.ref : against.dir;

  let ok = true;
  for (const config of configs) {
    let issues: CompatIssue[];
    try {
      issues = checkCompat(config, against);
    } catch (err) {
      if (!(err instanceof ManifestError)) throw err;
      console.error(`✖ ${err.message}`);
      ok = false;
      continue;
    }
    for (const issue of issues) {
      const where = issue.path ? ` · ${issue.path}` : "";
      console.log(`${issue.severity === "breaking" ? "✖" : "⚠"} ${issue.island}${where}: ${issue.message}`);
    }
    const breaking = issues.filter((i) => i.severity === "breaking");
    if (breaking.length) {
      ok = false;
      const changed = [...new Set(breaking.map((i) => i.island))];
      console.log(
        `\n${breaking.length} breaking change(s) in ${config} compared with ${baseLabel}.\n` +
          `Put them in a new version instead (${changed.map(nextVersion).join(", ")}), and keep the old ` +
          `version for apps already released.`,
      );
    } else {
      console.log(`✔ ${config}: no breaking changes compared with ${baseLabel}`);
    }
  }
  return ok;
}

const nextVersion = (island: string) => island.replace(/ v(\d+)$/, (_, v: string) => ` v${Number(v) + 1}`);

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
} else if (args.includes("--version")) {
  console.log(version());
} else if (args[0] === "compat") {
  process.exitCode = runCompat(args.slice(1)) ? 0 : 1;
} else {
  process.exitCode = runGenerate(args) ? 0 : 1;
}
