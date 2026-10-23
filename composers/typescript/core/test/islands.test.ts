// Island requests (spec §4.5): a paged island's next page, and one island resolved again.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createComposer,
  type Failure,
  InvalidCursorError,
  island,
  type IslandDescriptor,
  pagedIsland,
  place,
  type Plugin,
  reportErrors,
  type Requirement,
  screen,
  UnauthenticatedError,
} from "../src/index.ts";
import { testComposer } from "../src/testing.ts";

// Stand-ins for generated descriptors.
const ListV1: IslandDescriptor<{ items: number[] }> = { type: "list", version: 1 };
const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };

interface Ctx {
  viewer?: string;
}

const signedIn: Requirement<Ctx> = (ctx) => {
  if (!ctx.viewer) throw new UnauthenticatedError();
};
const viewerFrom = (request: Request): Ctx => ({
  viewer: request.headers.get("authorization") ?? undefined,
});

/** A paged island over 1..total, `size` at a time. Its cursor is the next offset. */
function numbers(total: number, size: number) {
  return pagedIsland<{ items: number[] }, Ctx>(ListV1, ({ cursor }) => {
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset <= (cursor === undefined ? -1 : 0) || offset >= total)
      throw new InvalidCursorError(`cursor ${cursor}`);
    const items = Array.from({ length: Math.min(size, total - offset) }, (_, i) => offset + i + 1);
    return {
      props: { items },
      ...(offset + size < total && { next: String(offset + size) }),
    };
  });
}

test("pages follow on from the screen, and an island resolves again without a cursor", async () => {
  const app = testComposer(
    createComposer({
      screens: [
        screen<Ctx>("numbers", {
          islands: [
            place(
              "header",
              island(HeaderV1, () => ({ name: "Numbers" })),
            ),
            place("list", numbers(5, 2)),
          ],
        }),
      ],
    }),
  );

  const first = await app.screen("numbers", { q: "all" });
  assert.deepEqual(first.props(ListV1, "list"), { items: [1, 2] });
  const list = first.island("list");
  assert.equal(list?.status === "ok" && list.next, "2");
  assert.equal(JSON.stringify(first.island("header")).includes("next"), false);

  const second = await app.nextPage(first, "list");
  assert.deepEqual(second.props(ListV1), { items: [3, 4] });
  const third = await app.next(second);
  assert.deepEqual(third.props(ListV1), { items: [5] });
  assert.equal(third.entry?.status === "ok" && third.entry.next, undefined);

  const again = await app.island("numbers", { q: "all" }, "list", 1);
  assert.deepEqual(again.props(ListV1), { items: [1, 2] });
  const header = await app.island("numbers", {}, "header", 1);
  assert.deepEqual(header.props(HeaderV1), { name: "Numbers" });

  const cases: [string, string, number, string | undefined, number, string][] = [
    ["a cursor it didn't make", "list", 1, "nope", 400, "invalid_cursor"],
    ["a cursor without pages", "header", 1, "2", 400, "invalid_cursor"],
    ["a version it doesn't have", "list", 2, undefined, 400, "unsupported_island_version"],
    ["a key it doesn't have", "footer", 1, undefined, 404, "unknown_island"],
  ];
  for (const [name, key, version, cursor, status, code] of cases) {
    const got = await app.island("numbers", {}, key, version, { cursor });
    assert.deepEqual([got.status, got.error], [status, code], name);
  }
  const unknown = await app.island("nowhere", {}, "list", 1);
  assert.deepEqual([unknown.status, unknown.error], [404, "unknown_screen"]);
});

test("an island request is laid out as its screen, and plugins see its cursor", async () => {
  const resolved: string[] = [];
  const trace: Plugin<Ctx> = {
    island: (next) => (call) => {
      resolved.push(`${call.screen}:${call.key}:${call.rc.cursor}`);
      return next(call);
    },
  };
  const app = testComposer(
    createComposer({
      context: viewerFrom,
      use: [trace],
      screens: [
        screen<Ctx>("mine", {
          requires: [signedIn],
          islands: [place("list", numbers(4, 2), { when: ({ params }) => params.show === "yes" })],
        }),
      ],
    }),
  );
  const asAda = { headers: { authorization: "ada" } };

  const signedOut = await app.island("mine", { show: "yes" }, "list", 1, { cursor: "2" });
  assert.deepEqual([signedOut.status, signedOut.error], [401, "unauthenticated"]);
  const hidden = await app.island("mine", { show: "no" }, "list", 1, { ...asAda, cursor: "2" });
  assert.deepEqual([hidden.status, hidden.error], [404, "unknown_island"]);
  const page = await app.island("mine", { show: "yes" }, "list", 1, { ...asAda, cursor: "2" });
  assert.deepEqual(page.props(ListV1), { items: [3, 4] });
  assert.deepEqual(resolved, ["mine:list:2"]);
});

test("a failing page is the island's: a 200 with its error, and reported", async () => {
  const failures: Failure[] = [];
  const failing = pagedIsland(ListV1, () => {
    throw new Error("boom");
  });
  const app = testComposer(
    createComposer({
      use: [reportErrors((f) => failures.push(f))],
      screens: [screen("s", { islands: [place("list", failing, { required: true })] })],
    }),
  );
  const got = await app.island("s", {}, "list", 1);
  assert.equal(got.status, 200);
  assert.deepEqual(got.entry?.status === "error" && got.entry.error, {
    code: "resolve_failed",
    retryable: false,
  });
  assert.deepEqual(
    failures.map((f) => [f.kind, f.kind === "island" && f.key]),
    [["island", "list"]],
  );
});
