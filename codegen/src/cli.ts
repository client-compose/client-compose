#!/usr/bin/env node
// Usage: client-compose-codegen (or, in this repo: node codegen/cli.ts) <client-compose.codegen.json> [--check]
//
// Generates island props types for every target in the config. With --check, writes nothing
// and exits 1 if any generated file is out of date (use in CI).

import { relative } from "node:path";
import { generate, ManifestError, stale, write } from "./index.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const configs = args.filter((a) => a !== "--check");
if (configs.length === 0) {
  console.error("usage: cli.ts <client-compose.codegen.json>... [--check]");
  process.exit(2);
}

let failed = false;
for (const config of configs) {
  try {
    const files = generate(config);
    const outdated = stale(files);
    if (check) {
      for (const f of outdated) console.error(`✖ out of date: ${relative(process.cwd(), f.path)}`);
      if (outdated.length) failed = true;
      else console.log(`✔ ${config}: ${files.length} file(s) up to date`);
    } else {
      write(outdated);
      for (const f of files) {
        console.log(`${outdated.includes(f) ? "wrote" : "unchanged"} ${relative(process.cwd(), f.path)}`);
      }
    }
  } catch (err) {
    if (!(err instanceof ManifestError)) throw err;
    console.error(`✖ ${err.message}`);
    failed = true;
  }
}
if (failed && check) console.error("\nRun codegen without --check to update.");
process.exit(failed ? 1 : 0);
