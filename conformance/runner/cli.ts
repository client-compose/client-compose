#!/usr/bin/env node
// Usage: node conformance/runner/cli.ts composer <baseUrl>
// Runs the composer conformance suite against a running conformance server (spec §8.1).

import { runComposerConformance } from "./src/index.ts";

const [suite, baseUrl] = process.argv.slice(2);
if (suite !== "composer" || !baseUrl) {
  console.error("usage: cli.ts composer <baseUrl>");
  process.exit(2);
}

const results = await runComposerConformance(baseUrl);
for (const r of results) {
  console.log(`${r.passed ? "✔" : "✖"} ${r.name}`);
  if (r.message) console.log(`  ${r.message}`);
}
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
