// Island requests (spec §4.5): an island's next page, from the composer.
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildIslandRequest, fetchIsland, IslandFetchError } from "../src/index.ts";
import { createFakeGateway, island, islandResponse, screenError } from "../src/testing.ts";

const List = { type: "list", version: 2 } as const;
const client = { platform: "web", appVersion: "1" };
const request = buildIslandRequest(
  "search",
  { q: "a" },
  { key: "results", version: 2 },
  client,
  "c2",
);

test("builds the request from the screen, its params, the island and the cursor", () => {
  assert.deepEqual(request, {
    protocol: 0,
    screen: "search",
    key: "results",
    version: 2,
    params: { q: "a" },
    client,
    cursor: "c2",
  });
});

test("resolves with the island's entry, its next page's cursor and all", async () => {
  const gateway = createFakeGateway({
    islands: {
      "search/results": () => islandResponse("search", island("results", List, { n: 2 }, "c3")),
    },
  });
  const entry = await fetchIsland("https://composer.test", request, {}, gateway.fetch);
  assert.deepEqual(entry, {
    key: "results",
    type: "list",
    version: 2,
    status: "ok",
    props: { n: 2 },
    next: "c3",
  });
  assert.equal(gateway.requests[0]?.url, "https://composer.test/screens/search/islands/results");
});

test("throws IslandFetchError for a failure, or an answer that isn't the island asked for", async () => {
  const answers = [
    screenError(400, "invalid_cursor"),
    islandResponse("search", island("other", List, { n: 2 })),
    islandResponse("search", island("results", { type: "list", version: 1 }, { n: 2 })),
    { status: 200, body: { protocol: 0, screen: "search" } },
  ];
  const gateway = createFakeGateway({
    islands: {
      "search/results": () => {
        const answer = answers.shift();
        assert.ok(answer);
        return answer;
      },
    },
  });
  const codes: (string | undefined)[] = [];
  for (let i = 0; i < 4; i++) {
    await assert.rejects(
      fetchIsland("https://composer.test", request, {}, gateway.fetch),
      (error) => {
        assert.ok(error instanceof IslandFetchError);
        codes.push(error.code);
        return true;
      },
    );
  }
  assert.deepEqual(codes, ["invalid_cursor", undefined, undefined, undefined]);
});
