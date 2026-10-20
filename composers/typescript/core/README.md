# @client-compose/composer

Framework-agnostic composer for [Client Compose](https://github.com/client-compose/client-compose):
decide which islands make up a screen and resolve their props from your backend services.

Tier: **core** · Protocol: **v0** · Node 20+ (or any runtime with `AbortController` and timers)

```sh
npm install @client-compose/composer
```

## Usage

```ts
import { createComposer, defineIsland, defineScreen } from "@client-compose/composer";
import { PostGridV1, ProfileHeaderV2 } from "./islands.generated"; // from @client-compose/codegen

type Ctx = { users: UsersService; posts: PostsService };

const header = defineIsland<ProfileHeaderV2, Ctx>(ProfileHeaderV2, async ({ params, ctx }) => {
  const user = await ctx.users.get(params.userId);
  return { userId: user.id, displayName: user.name, avatarUrl: user.avatar };
});

const posts = defineIsland<PostGridV1, Ctx>(PostGridV1, async ({ params, ctx, signal }) => ({
  posts: await ctx.posts.recent(params.userId, { signal }),
}));

const profile = defineScreen<Ctx>({
  id: "profile",
  cacheMaxAge: 30,
  layout: ({ client }) => [
    { key: "header", island: [header], required: true },
    { key: "posts", island: [posts], timeoutMs: 500 },
  ],
});

export const compose = createComposer([profile], {
  onIslandError: (key, type, error) => logger.warn({ key, type, error }, "island failed"),
});
```

Throw `NotFoundError` from a layout when what the params refer to doesn't exist (a batch loader's
missing key counts too); the screen responds 404 `not_found` and clients show their not-found UI.
`UnauthenticatedError` and `ForbiddenError` respond 401 and 403.
Add an optional `meta` function to describe the screen as a whole (page title, description, sharing
image); it runs alongside the islands and shares their `rc.load`s:

```ts
meta: async (rc) => {
  const recipe = await recipeById(rc, rc.params.recipeId);
  return { title: recipe.title, description: recipe.summary };
},
```

Each placement lists the versions the composer can resolve; the highest version the client also
supports is used. Islands resolve in parallel, each with its own timeout, and a failing island is
returned as an error for that island only, unless it's `required`.

## Loading data efficiently

Islands resolve in parallel, and several often need the same data. Three layers, from most to
least specific:

**1. Share data between islands in a request: `rc.load(key, fn)`.** The first call runs `fn`; every
other call with the same key in the same request (other islands, and the layout) gets the same
result. Wrap each lookup in a small helper so every island uses the same key:

```ts
// LayoutContext works for both the layout and resolvers.
const user = (rc: LayoutContext<Ctx>, id: string) =>
  rc.load(`user:${id}`, (signal) => rc.ctx.users.get(id, { signal }));

const header = defineIsland<ProfileHeaderV2, Ctx>(ProfileHeaderV2, async (rc) => {
  const u = await user(rc, rc.params.userId);
  return { userId: u.id, displayName: u.name, avatarUrl: u.avatar };
});
const follow = defineIsland<FollowButtonV1, Ctx>(FollowButtonV1, async (rc) => ({
  userId: rc.params.userId,
  isFollowing: await rc.ctx.follows.check(rc.params.userId),
  displayName: (await user(rc, rc.params.userId)).name, // same call as the header's
}));
```

Pass the `signal` that `load` gives `fn` to your fetch. It belongs to the request, not to one
island, so an island timing out never cancels work another island is waiting on.

**2. Combine lookups across islands into one call: `defineBatchLoader`.** When islands need
different items from the same service, a batch loader collects their keys (de-duplicated) and makes
one `getMany` call:

```ts
// Define once, at module level; batches and results are per request.
const userById = defineBatchLoader((ids: string[], signal) => users.getMany(ids, { signal }));

// in any resolver or layout:
const author = await userById.load(rc, post.authorId);
```

`fetch` returns a `Map` keyed by id, or an array aligned with `ids` (`undefined` for a missing id,
which rejects with `LoadNotFoundError`). Options: `maxBatchSize`, `windowMs`, `cacheKey`.

**3. Cache across requests in your service clients, not here.** `load` and batch loaders are scoped
to one request on purpose, so one user's data never leaks into another's screen. For data that can
be shared (catalogue entries, feature config), cache it in the service client (HTTP caching, a TTL
cache), keyed by everything the result depends on, including the viewer when it's personalised.

Rules of thumb:

- Put every input in the key (`user:${id}`, `posts:${id}:recent`). The viewer doesn't need to be in
  it: a request only ever has one.
- Loading in the layout is fine: if the layout needs the user to decide which islands to show, the
  islands that also need it reuse the same call.
- A failed load fails every island that awaited it (each as its own island error); it isn't retried
  within the request.

## Actions

Actions (spec §5) change things. Define each version with its generated descriptor. Return a
result (and optionally the screens it changed) or one of the declared errors:

```ts
import { createActions, defineAction, UnauthenticatedError } from "@client-compose/composer";
import { FollowUserV1 } from "./actions.generated"; // from @client-compose/codegen

const follow = defineAction<FollowUserV1Input, FollowUserV1Result, FollowUserV1Error, Ctx>(
  FollowUserV1,
  async ({ userId }, { ctx, idempotencyKey }) => {
    if (!ctx.user) throw new UnauthenticatedError(); // 401
    if (await ctx.blocks.has(userId, ctx.user)) return { error: { code: "blocked" } }; // typed
    const followers = await ctx.follows.add(ctx.user, userId, idempotencyKey);
    return { result: { followers }, effects: { invalidate: [{ screen: "profile", params: { userId } }] } };
  },
);

export const perform = createActions([follow], {
  onActionError: (action, version, error) => logger.error({ action, version, error }, "action failed"),
});
```

- Input is validated against the manifest first (400 `invalid_input`). Null optional properties
  are removed, so handlers see what their types say.
- A thrown error (other than `NotFoundError`, `UnauthenticatedError` or `ForbiddenError`), or an
  error code the action doesn't declare, is a failure: 500 `action_failed`, reported to
  `onActionError`.
- `load` and batch loaders work as in resolvers, scoped to the action request.

## Serving it

Use an adapter such as [`@client-compose/node-http`](https://www.npmjs.com/package/@client-compose/node-http),
or write one for your framework: route `POST /screens/:screen`, read the raw body, and call
`composeHttp`, which parses and validates the request and returns the protocol's status codes.

```ts
import { composeHttp, performHttp } from "@client-compose/composer";

app.post("/screens/:screen", async (req, res) => {
  const result = await composeHttp(compose, req.params.screen, await readBody(req), { users, posts });
  res.status(result.status).json(result.body);
});

app.post("/actions/:action", async (req, res) => {
  const result = await performHttp(perform, req.params.action, await readBody(req), { users, posts });
  res.status(result.status).json(result.body);
});
```

## Conformance

`conformanceScreen()` and `conformanceActions()` are the test-only screen and actions used by the
shared conformance suite; register them only in a test server. See [`@client-compose/conformance`](https://www.npmjs.com/package/@client-compose/conformance).

## Links

- [Protocol spec](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md)
- [Examples](https://github.com/client-compose/client-compose/tree/main/examples/profile)
