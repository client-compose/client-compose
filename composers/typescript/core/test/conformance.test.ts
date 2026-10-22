// The composer suite (spec §8.1), run in-process against the fetch-standard handler.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionCases, composerCases, runActionCase, runComposerCase } from "@client-compose/conformance";
import { conformanceActions, conformanceScreen, createComposer } from "../src/index.ts";

const composer = createComposer({ screens: [conformanceScreen()], actions: conformanceActions() });
const fetchImpl = (input: string | URL | Request, init?: RequestInit) => composer.fetch(new Request(input, init));
// Under a prefix, to check the handler finds its routes wherever it's mounted.
const baseUrl = "https://composer.test/compose";

for (const c of composerCases()) {
  test(c.name, async () => {
    const result = await runComposerCase(baseUrl, c, fetchImpl);
    assert.ok(result.passed, result.message);
  });
}

for (const c of actionCases()) {
  test(`action: ${c.name}`, async () => {
    const result = await runActionCase(baseUrl, c, fetchImpl);
    assert.ok(result.passed, result.message);
  });
}
