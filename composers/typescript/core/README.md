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

Each placement lists the versions the composer can resolve; the highest version the client also
supports is used. Islands resolve in parallel, each with its own timeout, and a failing island is
returned as an error for that island only, unless it's `required`.

## Serving it

Use an adapter such as [`@client-compose/node-http`](https://www.npmjs.com/package/@client-compose/node-http),
or write one for your framework: route `POST /screens/:screen`, read the raw body, and call
`composeHttp`, which parses and validates the request and returns the protocol's status codes.

```ts
app.post("/screens/:screen", async (req, res) => {
  const result = await composeHttp(compose, req.params.screen, await readBody(req), { users, posts });
  res.status(result.status).json(result.body);
});
```

## Conformance

`conformanceScreen()` is the test-only screen used by the shared conformance suite; register it
only in a test server. See [`@client-compose/conformance`](https://www.npmjs.com/package/@client-compose/conformance).

## Links

- [Protocol spec](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md)
- [Examples](https://github.com/client-compose/client-compose/tree/main/examples/profile)
