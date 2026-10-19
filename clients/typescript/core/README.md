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
- **`fetchScreen`** throws `ScreenFetchError` (with `status` and `body`) for non-2xx responses, and
  accepts a custom `fetch` as its fourth argument.

Props aren't validated at runtime; generate types with
[`@client-compose/codegen`](https://www.npmjs.com/package/@client-compose/codegen) to keep them in
sync with the composer.

## Links

- [Protocol spec](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md)
- [Examples](https://github.com/client-compose/client-compose/tree/main/examples/profile)
