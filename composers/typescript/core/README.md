# @client-compose/composer

The composer for [Client Compose](https://github.com/client-compose/client-compose), in TypeScript.
It decides what each screen is made of and resolves its islands' props, in parallel, from your
services. You declare screens as data; it handles version negotiation, timeouts and failure
isolation, and serves them from any HTTP stack.

Tier: **core** · Protocol: **v0** · Node 20+, Bun, Deno, Cloudflare Workers (anything with `fetch`'s `Request` and `Response`)

```sh
npm install @client-compose/composer
```

## Usage

```ts
import { action, createComposer, island, place, placeStatic, reportErrors, screen } from "@client-compose/composer";
import { FollowButtonV1, PostGridV1, ProfileHeaderV2, ReportLinkV1 } from "./islands.generated"; // from @client-compose/codegen

interface Ctx {
  viewer?: User;
}

const ProfileHeader = island(ProfileHeaderV2, async ({ params, load }) => {
  const user = await load(`user:${params.userId}`, (signal) => users.get(params.userId, { signal }));
  return { displayName: user.name, avatarUrl: user.avatar };
});

const profile = screen<Ctx>("profile", {
  requires: [signedIn],
  islands: [
    place("header", ProfileHeader, { required: true }),
    place("follow", FollowButton, { when: ({ ctx, params }) => ctx.viewer?.id !== params.userId }),
    place("posts", [PostGridV1Island, PostGridV2Island], { timeoutMs: 300 }),
    placeStatic("report", ReportLinkV1, { label: "Report this profile" }),
  ],
  cache: { maxAge: 30 },
});

export const composer = createComposer<Ctx>({
  screens: [profile],
  actions: [followUser],
  context: async (request) => ({ viewer: await sessions.viewer(request) }),
  use: [reportErrors((failure) => logger.error(failure, "composer failure"))],
});

export default { fetch: composer.fetch }; // Bun, Deno, Workers, Hono, Next.js route handlers
```

## Screens

A screen lists its islands in order. `place(key, versions, options)` puts one there:

- **versions**: one island, or every version you can resolve. The highest the app supports is sent;
  if there's none, the island is left out.
- **`required`**: the screen fails without it.
- **`timeoutMs`**: overrides `defaultTimeoutMs` (2000).
- **`when`**: decides per request whether it appears, e.g. no follow button on your own profile. It
  can load data (sharing loads with the islands), and what it throws is handled like a layout's:
  `NotFoundError` answers 404.

`placeStatic(key, Descriptor, props)` places an island whose props are known up front: a form, a
heading.

When a screen's islands can only be decided per request (from a CMS, or an experiment), give it a
`layout` function instead of `islands`. Throw `NotFoundError` from it when what the params refer to
doesn't exist (a batch loader's missing key counts too); the screen responds 404 `not_found`.

`meta` optionally describes the screen as a whole (page title, description, sharing image). It runs
alongside the islands and shares their `load`s; if it fails, the response just has no meta:

```ts
meta: async ({ params, load }) => {
  const recipe = await load(`recipe:${params.recipeId}`, () => recipes.get(params.recipeId));
  return { title: recipe.title, description: recipe.summary };
},
```

## Context and requirements

`context` runs once per request, before anything else, and returns what every requirement, layout,
island and action receives as `ctx`: the viewer, their locale, a tenant. It's given your server's
request: a fetch `Request` by default, or whatever your adapter passes (an Express or Fastify request,
a node:http `IncomingMessage`). Say which with the composer's second type parameter:
`createComposer<Ctx, express.Request>(…)`.

A requirement checks the context and the request before a screen or action runs. Throw
`UnauthenticatedError`, `ForbiddenError` or `NotFoundError` and the app gets 401, 403 or 404,
without your islands or action running:

```ts
const signedIn: Requirement<Ctx> = (ctx) => {
  if (!ctx.viewer) throw new UnauthenticatedError();
};

// A screen for editing a recipe: 404 if there's no such recipe, 403 unless the viewer may edit it.
const editsRecipe: Requirement<Ctx> = async (ctx, { params }) => {
  await recipes.editable(ctx.viewer, params.recipeId);
};
```

Requirements run in order, so put `signedIn` first. An action's requirements see its client context
but no params; check its input in the action itself.

Islands and actions can throw those errors too, when they find out late.

## Actions

Actions (spec §5) change things. Define each version with its generated descriptor and return a
result (and the screens it changed), or one of its declared errors:

```ts
import { FollowUserV1 } from "./actions.generated"; // from @client-compose/codegen

const followUser = action(
  FollowUserV1,
  async ({ userId }, { ctx, idempotencyKey }) => {
    if (await blocks.has(userId, ctx.viewer)) return { error: { code: "blocked" } }; // typed
    const followers = await follows.add(ctx.viewer, userId, idempotencyKey);
    return { result: { followers }, effects: { invalidate: [{ screen: "profile", params: { userId } }] } };
  },
  { requires: [signedIn] },
);
```

- Requirements are checked first, then the input is validated against the manifest (400
  `invalid_input`). Null optional properties are removed, so your code sees what its types say.
- A thrown error (other than `NotFoundError`, `UnauthenticatedError` or `ForbiddenError`), or an error
  code the action doesn't declare, is a failure: 500 `action_failed`, reported to plugins.
- `load` and batch loaders work as in islands, scoped to the action request.

## Plugins

A plugin hooks into the composer. Set the hooks you need:

| Hook | Wraps | For |
| --- | --- | --- |
| `context` | each request, after your `context` function | adding to the context: the viewer from a token, a tenant |
| `screen` | composing a whole screen | tracing, metrics, caching whole anonymous screens |
| `island` | resolving one island version | caching props, tracing, per-island metrics |
| `action` | performing an action | idempotency stores, rate limits, audit logs |
| `error` | every failure | logs, error tracking |

Plugins run in the order they're listed in `use`, the first outermost:

```ts
const tracing: Plugin<Ctx> = {
  island: (next) => async (call) => {
    const span = tracer.startSpan(`island ${call.island.type}`);
    try {
      return await next(call);
    } finally {
      span.end();
    }
  },
};
```

`reportErrors(fn)` is a plugin with just an `error` hook.

## Islands with pages

A feed or a list of results sends its first page with the screen, and its next pages as the person
scrolls (spec §4.5). Define it with `pagedIsland`: it resolves the page `cursor` asks for (the
first when it's undefined) to that page's props, and the cursor of the page after it. The cursor is
yours: whatever you need to go on, such as an offset, and the time the first page was made so that
newer items don't push the list along.

```ts
const Results = pagedIsland(ResultListV1, async ({ params, cursor }) => {
  const from = readCursor(cursor); // throws InvalidCursorError: 400 invalid_cursor
  const { items, more } = await search(params.q, from);
  return { props: { items }, ...(more && { next: makeCursor(from.after(items)) }) };
});
```

The island's entry carries `next` while there are more pages. Clients fetch them from
`POST /screens/{screen}/islands/{key}`, which lays the screen out as it would (requirements,
layout, `when`) and resolves that one island. The same request without a cursor resolves any
island again, so a client can refresh one without the whole screen. Paged islands aren't cached.

In tests, `app.nextPage(screen, "results")` fetches the page after a screen's island, `app.next`
the one after that, and `page.props(ResultListV1)` reads it.

## Strings

Every word an app shows comes from the composer (spec §4.7), so copy changes, and new languages
ship, without an app release. Islands declare their strings in their manifests, and the app its
own in an app strings manifest; the words are a catalog, one JSON file per language:

```json
// strings/pl.json
{
  "app": { "loading": "Ładowanie" },
  "islands": {
    "recipe-list@1": {
      "heading": "Najnowsze przepisy",
      "count": { "#1": "{count} przepis", "#few": "{count} przepisy", "#*": "{count} przepisów" }
    }
  }
}
```

```ts
const composer = createComposer({
  screens,
  strings: { catalog: loadCatalog("strings"), defaultLocale: "en" },
});
```

Each island's entry then carries its strings in the client's `locale`, or the nearest language the
catalog has (`pl-PL`, then `pl`, then the default), with any string a language lacks taken from
the default. The stream's head says which language that is, with its plural rules, for counted
strings. `POST /strings` answers the app strings, without running `context`, since an app needs
its words before anyone signs in. `client-compose-codegen strings` checks the catalog against the
manifests.

In tests, `app.strings({ locale: "pl" })` fetches the app strings, and an island's entry has its
`strings`.

## Caching islands (optional)

To keep an island's props between requests, give the composer a `Cache` and opt islands in. The
cache is your own: implement `get` and `set` with whatever you run. Without `cache`, nothing is
cached and every island resolves on every request.

```ts
// Your adapter, e.g. over node-redis:
const redisCache: Cache = {
  get: async (key) => (await redis.get(key)) ?? undefined,
  set: async (key, value, ttlMs) => {
    await redis.set(key, value, { PX: ttlMs });
  },
};

// Islands say how long, and what their props depend on:
const Trending = island(TrendingV1, resolveTrending, { cache: { ttlMs: 300_000, key: () => "all" } });
const Feed = island(FeedV1, resolveFeed, {
  cache: { ttlMs: 30_000, key: ({ ctx, params }) => `${ctx.viewer?.id}:${params.page}` }, // personalised
});

const composer = createComposer({ screens, cache: redisCache });
```

- The key function returns what the props depend on; the composer adds the island's type and
  version. Return undefined to skip the cache for this request.
- Failures are never cached.
- If the cache errors, the island resolves anyway and the error reaches plugins as a `"cache"`
  failure, so a cache outage never breaks a screen.
- In tests, `memoryCache()` from `@client-compose/composer/testing` is an in-memory `Cache`.

## Retried actions (optional)

Apps send an idempotency key with each action, and reuse it when they retry the same intent. Give
the composer an `IdempotencyStore` and it honours those keys for every action: the first call runs,
and a retry gets the first outcome back instead of running again. The store is your own; without
`idempotency`, keys just pass through to your actions as `idempotencyKey`.

```ts
const composer = createComposer<Ctx>({
  actions,
  idempotency: {
    store: redisIdempotency, // your adapter: begin, finish, release
    scope: (ctx) => ctx.viewer?.id ?? "", // whose keys these are
  },
});
```

- With Redis, `begin` is a `SET NX` of a "running" marker (returning the outcome if one is stored),
  `finish` a `SET` of the outcome, and `release` a `DEL`.
- `scope` is required, so one caller can never replay another's key. Return `""` for actions anyone
  may share.
- Only completed outcomes are kept: results and declared errors. A failure releases the key, so a
  retry runs again.
- A duplicate that arrives while the first call is running waits for it (`waitMs`, default 10s).
- Outcomes are kept for `ttlMs` (default 24h).
- If the store errors, the action runs anyway and the error reaches plugins as an `"idempotency"`
  failure.
- In tests, `memoryIdempotencyStore()` from `@client-compose/composer/testing` is an in-memory store.

## Streaming

Every screen is answered as a stream (spec §4.6), so apps can show it as it arrives. The composer
sends its head once everything that could fail the whole screen is settled: its requirements and
layout (including each `when`), its `required` islands and its `meta`. Islands not ready by then are
`pending` in the head, and follow, each on its own line, as they're resolved. Then the stream ends.

So which islands are worth marking `required`, and what conditions cost, now decide how soon a screen
shows: a required island holds back the head, and so does a `when` that waits on slow data. Shared
loads live until the stream ends.

`composer.fetch` and the adapters send each line as it's ready. In process, a successful
`composer.compose(req, ctx)` result's `body` is a `ScreenStream` (its `head`, and the `islands` still
to come, as an async iterable); `collect(stream)` puts the screen together.

## Serving it

`composer.fetch` is a fetch-standard handler. It answers POST requests whose path ends in
`/screens/{screen}`, `/screens/{screen}/islands/{key}` or `/actions/{action}`, so you can mount it
under any prefix:

```ts
// Bun, Deno, Cloudflare Workers
export default { fetch: composer.fetch };

// Hono
app.all("/compose/*", (c) => composer.fetch(c.req.raw));

// Next.js route handler: app/compose/[...path]/route.ts
export const POST = composer.fetch;
```

For Node servers there are adapters, which pass their own request type to `context`:

| Server | Package |
| --- | --- |
| node:http | [`@client-compose/node-http`](https://www.npmjs.com/package/@client-compose/node-http) |
| Express | [`@client-compose/express`](https://www.npmjs.com/package/@client-compose/express) |
| Fastify | [`@client-compose/fastify`](https://www.npmjs.com/package/@client-compose/fastify) |

Writing one for another server is a few lines: hand `composer.handle(path, rawBody, request)` the
request, and write the status, content type and body it returns. The body is a string, or for a
screen, its stream's lines as an async iterable: write each as it comes.

## Loading data efficiently

Islands resolve in parallel, and several often need the same data. Three layers, from most to
least specific:

**1. Share data between islands in a request: `load(key, fn)`.** The first call runs `fn`; every
other call with the same key in the same request (other islands, the layout, meta, `when`) gets the
same result. Wrap each lookup in a small helper so every island uses the same key:

```ts
// LayoutContext works for layouts, `when`, meta and islands.
const user = (rc: LayoutContext<Ctx>, id: string) => rc.load(`user:${id}`, (signal) => users.get(id, { signal }));
```

Pass the `signal` that `load` gives `fn` to your fetch. It belongs to the request, not to one
island, so an island timing out never cancels work another island is waiting on.

**2. Combine lookups across islands into one call: `defineBatchLoader`.** When islands need
different items from the same service, a batch loader collects their keys (de-duplicated) and makes
one call:

```ts
// Define once, at module level; batches and results are per request.
const userById = defineBatchLoader((ids: string[], signal) => users.getMany(ids, { signal }));

// in any island, layout or action:
const author = await userById.load(rc, post.authorId);
const authors = await userById.loadMany(rc, authorIds); // rejects if any is missing
```

`fetch` returns a `Map` keyed by id, or an array aligned with `ids` (`undefined` for a missing id,
which rejects with `LoadNotFoundError`). Options: `maxBatchSize`, `windowMs`, `cacheKey`.

**3. Cache across requests in your service clients, not here.** `load` and batch loaders are scoped
to one request on purpose, so one user's data never leaks into another's screen.

## Testing

`@client-compose/composer/testing` calls your composer in-process, the way apps do, so your context
function, requirements and plugins all run, and gives you typed results:

```ts
import { testComposer } from "@client-compose/composer/testing";

const app = testComposer(composer);

const profile = await app.screen("profile", { userId: "u1" }, { headers: { authorization: "Bearer t" } });
assert.deepEqual(profile.keys(), ["header", "posts"]);
const header = profile.props(ProfileHeaderV2, "header");

const followed = await app.perform(FollowUserV1, { userId: "u1" });
assert.equal(followed.result?.followers, 8);
```

- By default the app declares every island your declared screens place. To test an older app,
  `testComposer(composer, { declare: [ProfileHeaderV1, PostGridV1] })`.
- Screens give `status`, `keys()`, `island(key)`, `props(Descriptor, key)` and the full `response`,
  with every island in place; `head` is its stream's head, to check what was pending. Errors come
  back as their protocol code (`"not_found"`, `"unauthenticated"`).
- `perform` gives the typed `result`, `effects`, the declared `error`, or the protocol `failure`.
- For a composer whose `context` takes an Express or Fastify request, pass `request` to build one.

## Conformance

`conformanceScreen()` and `conformanceActions()` are the test-only screen and actions used by the
shared conformance suite; register them only in tests. The suite runs against `composer.fetch`
in-process, with no server: see [`@client-compose/conformance`](https://www.npmjs.com/package/@client-compose/conformance).

## Links

- [Protocol spec](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md)
- [Capabilities](https://github.com/client-compose/client-compose/blob/main/spec/CAPABILITIES.md)
- [Examples](https://github.com/client-compose/client-compose/tree/main/examples/profile)
