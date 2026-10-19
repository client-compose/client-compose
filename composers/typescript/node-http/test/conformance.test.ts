import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { composerCases, runComposerCase } from "@client-compose/conformance";
import { conformanceServer } from "../conformance-server.ts";

const server = conformanceServer().listen(0);
const baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

for (const c of composerCases()) {
  test(c.name, async () => {
    const result = await runComposerCase(baseUrl, c);
    assert.ok(result.passed, result.message);
  });
}

test.after(() => server.close());
