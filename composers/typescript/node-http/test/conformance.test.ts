import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  actionCases,
  composerCases,
  runActionCase,
  runComposerCase,
} from "@client-compose/conformance";

import { conformanceServer } from "../conformance-server.ts";

const server = conformanceServer().listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

for (const c of composerCases()) {
  test(c.name, async () => {
    const result = await runComposerCase(baseUrl, c);
    assert.ok(result.passed, result.message);
  });
}

for (const c of actionCases()) {
  test(`action: ${c.name}`, async () => {
    const result = await runActionCase(baseUrl, c);
    assert.ok(result.passed, result.message);
  });
}

test.after(() => server.close());
