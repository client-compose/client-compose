import { test } from "node:test";
import assert from "node:assert/strict";
import { actionCases, composerCases, runActionCase, runComposerCase } from "@client-compose/conformance";
import { conformanceServer } from "./conformance-server.ts";

for (const json of [false, true]) {
  const { baseUrl, close } = await conformanceServer({ json });
  const setup = json ? "behind express.json()" : "alone";

  for (const c of composerCases()) {
    test(`${setup}: ${c.name}`, async () => {
      const result = await runComposerCase(baseUrl, c);
      assert.ok(result.passed, result.message);
    });
  }

  for (const c of actionCases()) {
    test(`${setup}: action: ${c.name}`, async () => {
      const result = await runActionCase(baseUrl, c);
      assert.ok(result.passed, result.message);
    });
  }

  test.after(close);
}
