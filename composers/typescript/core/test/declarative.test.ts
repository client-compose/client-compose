import { test } from "node:test";
import assert from "node:assert/strict";
import {
  action,
  createComposer,
  defineBatchLoader,
  island,
  LoadNotFoundError,
  place,
  placeStatic,
  reportErrors,
  screen,
  UnauthenticatedError,
  type Failure,
  type IslandDescriptor,
  type Plugin,
  type Requirement,
} from "../src/index.ts";
import { testComposer } from "../src/testing.ts";
import { ConformanceV1 } from "../src/conformance-actions.generated.ts";

// Stand-ins for generated descriptors.
const HeaderV1: IslandDescriptor<{ name: string }> = { type: "header", version: 1 };
const FormV1: IslandDescriptor<{ label: string }> = { type: "form", version: 1 };

interface Ctx {
  viewer?: string;
}

// What an auth integration would provide.
const signedIn: Requirement<Ctx> = (ctx) => {
  if (!ctx.viewer) throw new UnauthenticatedError();
};
const viewerFrom = (request: Request): Ctx => {
  const token = request.headers.get("authorization");
  if (token === "bad") throw new UnauthenticatedError();
  return { viewer: token ?? undefined };
};
const as = (viewer: string) => ({ headers: { authorization: viewer } });

const header = island(HeaderV1, ({ params }) => ({ name: params.userId }));

test("declared screens: islands in order, `when` per request, static islands", async () => {
  const profile = screen<Ctx>("profile", {
    islands: [
      place("header", header, { required: true }),
      { ...placeStatic("edit", FormV1, { label: "Edit profile" }), when: ({ ctx, params }) => ctx.viewer === params.userId },
    ],
  });
  const app = testComposer(createComposer({ screens: [profile], context: viewerFrom }));

  const mine = await app.screen("profile", { userId: "ada" }, as("ada"));
  assert.deepEqual(mine.keys(), ["header", "edit"]);
  assert.deepEqual(mine.props(HeaderV1, "header"), { name: "ada" });
  assert.deepEqual(mine.props(FormV1, "edit"), { label: "Edit profile" });

  const theirs = await app.screen("profile", { userId: "grace" }, as("ada"));
  assert.deepEqual(theirs.keys(), ["header"]);
});

test("requirements and the context function answer 401 before anything runs", async () => {
  let ran = false;
  const profile = screen<Ctx>("profile", {
    requires: [signedIn],
    islands: [place("header", header)],
  });
  const echo = action(
    ConformanceV1,
    (input) => {
      ran = true;
      return { result: { echo: input.echo, version: 1 } };
    },
    { requires: [signedIn] },
  );
  const app = testComposer(createComposer<Ctx>({ screens: [profile], actions: [echo], context: viewerFrom }));

  assert.equal((await app.screen("profile")).error, "unauthenticated");
  assert.equal((await app.screen("profile", {}, as("bad"))).status, 401);
  assert.equal((await app.screen("profile", { userId: "ada" }, as("ada"))).status, 200);

  // Requirements come before input validation: a signed-out caller learns nothing about the input.
  assert.equal((await app.perform(ConformanceV1, {} as never)).failure, "unauthenticated");
  assert.equal(ran, false);
  const done = await app.perform(ConformanceV1, { outcome: "ok", echo: "hi" }, as("ada"));
  assert.deepEqual([done.status, done.result], ["ok", { echo: "hi", version: 1 }]);
});

test("plugins wrap in order, add context, and hear failures", async () => {
  const calls: string[] = [];
  const tracing = (name: string): Plugin<Ctx> => ({
    screen: (next) => async (req, ctx) => {
      calls.push(`${name}:screen:${req.screen}`);
      return next(req, ctx);
    },
    island: (next) => async (call) => {
      calls.push(`${name}:island:${call.key}`);
      return next(call);
    },
  });
  const failures: Failure[] = [];
  const broken = island<{ ok: boolean }, Ctx>({ type: "broken", version: 1 }, ({ ctx }) => {
    throw new Error(`down for ${ctx.viewer}`);
  });
  const composer = createComposer<Ctx>({
    screens: [screen("s", { islands: [place("b", broken)] })],
    use: [tracing("outer"), tracing("inner"), { context: () => ({ viewer: "plugin-viewer" }) }, reportErrors((f) => failures.push(f))],
  });

  const s = await testComposer(composer).screen("s");
  assert.equal(s.island("b")?.status, "error");
  assert.deepEqual(calls, ["outer:screen:s", "inner:screen:s", "outer:island:b", "inner:island:b"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, "island");
  assert.equal(failures[0].key, "b");
  assert.equal((failures[0].error as Error).message, "down for plugin-viewer");
});

test("config mistakes throw", () => {
  const profile = screen("profile", { islands: [] });
  assert.throws(() => createComposer({ screens: [profile, profile] }), /defined twice/);
  assert.throws(() => screen("empty", {}), /needs either islands or layout/);
  assert.throws(() => screen("both", { islands: [], layout: () => [] }), /needs either islands or layout/);
});

test("loadMany batches keys, and rejects if any is missing", async () => {
  const fetches: string[][] = [];
  const users = defineBatchLoader(async (ids: string[]) => {
    fetches.push([...ids].sort());
    return new Map(ids.filter((id) => id !== "missing").map((id) => [id, id.toUpperCase()]));
  });
  let got: Map<string, string> | undefined;
  let missing: unknown;
  const s = screen("s", {
    layout: async (rc) => {
      got = await users.loadMany(rc, ["a", "b", "a"]);
      missing = await users.loadMany(rc, ["c", "missing"]).catch((e) => e);
      return [];
    },
  });
  await testComposer(createComposer({ screens: [s] })).screen("s");
  assert.deepEqual([...got!], [["a", "A"], ["b", "B"]]);
  assert.ok(missing instanceof LoadNotFoundError);
  assert.deepEqual(fetches[0], ["a", "b"]);
});

test("the test kit declares an older app's islands", async () => {
  const HeaderV2: IslandDescriptor<{ name: string; badge?: string }> = { type: "header", version: 2 };
  const s = screen("s", { islands: [place("header", [header, island(HeaderV2, () => ({ name: "v2" }))])] });
  const composer = createComposer({ screens: [s] });
  assert.deepEqual(composer.islands(), { header: [1, 2] });
  const old = await testComposer(composer, { declare: [HeaderV1] }).screen("s", { userId: "ada" });
  assert.deepEqual(old.props(HeaderV1, "header"), { name: "ada" });
  assert.throws(() => old.props(HeaderV2, "header"), /is header v1, not header v2/);
});
