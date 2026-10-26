# @client-compose/client

Framework-agnostic client for [Client Compose](https://github.com/client-compose/client-compose):
a protocol for server-composed screens made of client-owned islands.

Tier: **core** · Protocol: **v0** · Any JS runtime with `fetch` (browsers, React Native, Node 20+)

```sh
npm install @client-compose/client
```

> Using React or React Native? Use [`@client-compose/react`](https://www.npmjs.com/package/@client-compose/react),
> which builds on this package.

## Usage

`IslandRegistry<R>` maps island types and versions to renderers. `R` is whatever your UI renders
(a DOM node, a string of HTML, a framework element), so this core works with any UI layer.

```ts
import { buildRequest, fetchScreen, IslandRegistry, plan } from "@client-compose/client";
import { ProfileHeaderV2 } from "./islands.generated"; // from @client-compose/codegen

const registry = new IslandRegistry<HTMLElement>()
  .register(ProfileHeaderV2, (props) => renderProfileHeader(props));

const request = buildRequest(registry, "profile", { platform: "web", appVersion: "1.4.0" }, { userId });
const response = await fetchScreen("https://api.example.com/compose", request, {
  headers: { Authorization: `Bearer ${token}` },
});

const islands = plan(registry, response, {
  onSkipped: (entry, reason) => console.warn("skipped island", entry.key, reason),
});
container.replaceChildren(...islands.map((island) => island.render()));
```

- **`buildRequest`** sends the island types and versions this client can render, so the composer
  never returns one it can't.
- **`plan`** returns renderable islands in order. Errored islands are omitted unless you pass
  `onError`; islands with an unknown type, version or status are skipped and reported.
- **`fetchScreen`** reads the screen's stream to its end, and returns it whole. It throws
  `ScreenFetchError` (with `status` and `body`) for non-2xx responses, and accepts a custom `fetch`
  as its fourth argument.

## Streams

A screen arrives as a stream (spec §4.6): its head, with any island not yet ready `pending`, then
each of those as the composer resolves it. **`openScreen`** resolves once the head is in, so you can
show the screen and fill it in:

```ts
const stream = await openScreen(baseUrl, request, init);
let screen = stream.head;
show(plan(registry, screen)); // pending islands are their placeholders, or left out
for await (const island of stream.islands) {
  screen = withIsland(screen, island);
  show(plan(registry, screen));
}
```

- Register a placeholder for an island with `registry.registerPlaceholder(Descriptor, () => …)`:
  `plan` shows it while the island is pending. Without one, the island is left out until it arrives.
- An island the stream never brings (the connection dropped) arrives as an error, `incomplete`,
  retryable.
- `collectScreen(stream)` reads the rest and returns the whole screen.
- The body is read as it comes when your `fetch` gives a readable stream (browsers, Node, Deno, Bun,
  and `expo/fetch` in React Native). React Native's built-in `fetch` doesn't, so there the screen
  arrives all at once.

## Actions

```ts
import { ActionFetchError, callAction } from "@client-compose/client";
import { FollowUserV1 } from "./actions.generated"; // from @client-compose/codegen

const res = await callAction("https://api.example.com/compose", FollowUserV1, { userId }, {
  client: { platform: "web", appVersion: "1.4.0" },
  init: { headers: { Authorization: `Bearer ${token}` } },
});
if (res.status === "ok") showFollowers(res.result.followers); // and reload res.effects?.invalidate
else if (res.error.code === "blocked") showBlocked();
else showGenericError(); // codes added after this app was built
```

- Declared errors are outcomes (`status: "error"`), typed per action. Anything else, such as
  `invalid_input`, `unauthenticated` or `action_failed`, throws `ActionFetchError` with `status`
  and `code`.
- Each call sends a new idempotency key. Pass `idempotencyKey` yourself to retry the same intent.

Props aren't validated at runtime; generate types with
[`@client-compose/codegen`](https://www.npmjs.com/package/@client-compose/codegen) to keep them in
sync with the composer.

## Islands with pages

An island entry carries `next` while the island has more pages (spec §4.5).
`fetchIsland(baseUrl, buildIslandRequest(screen, params, entry, client, entry.next))` fetches the
next one: the island's entry again, with that page's props and its own `next`. Without a cursor, it
resolves the island again from its first page. The React binding's `usePages` does this for you.

## Testing

`@client-compose/client/testing` is a fake composer for tests, with no test framework of its own.
`createFakeGateway` answers screen and action requests from handlers and records them; pass its
`fetch` to the client. Build responses with `island`, `islandError`, `screen`, `screenError`,
`actionOk`, `actionError` and `actionFailure`, typed by the generated descriptors. A `screen` is
sent whole (a head and an end); to control when each island arrives, answer with
`streamedScreen(id, [island(…), pending(key, Descriptor)])`, then call its `send(entry)`, `end()`,
or `cut()` for a dropped connection.

```ts
import { actionError, createFakeGateway } from "@client-compose/client/testing";

const gateway = createFakeGateway({
  actions: { follow: () => actionError(FollowUserV1, { code: "blocked" }) },
});
const res = await callAction(baseUrl, FollowUserV1, { userId }, { client, fetch: gateway.fetch });
assert.equal(gateway.actionRequests()[0].input.userId, userId);
```

For code that calls the global `fetch` itself, such as a whole app rendered in a test,
`installFakeGateway(handlers)` puts the fake composer in its place; call `restore()` afterwards.

For React, `@client-compose/react/testing` adds a provider config built around it.

## Through your own server

`@client-compose/client/proxy` passes a browser's screen, island and action requests to the composer
through your server, so it can add what the browser mustn't hold, such as a session kept in an
httpOnly cookie. `createComposerProxy({ baseUrl, client, headers, onActionResponse })` checks each
request (anyone can call a server endpoint with anything), sets the client context and headers,
and returns the composer's failures as data. `@client-compose/react`'s `viaProxy` is the browser
half.

## Links

- [Protocol spec](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md)
- [Examples](https://github.com/client-compose/client-compose/tree/main/examples/profile)
