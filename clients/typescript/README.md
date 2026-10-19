# TypeScript client

Tier: **core** · Protocol: **v0** · Any JS runtime with `fetch`

`core` (`@client-compose/client`): `IslandRegistry<R>`, `buildRequest`, `plan`, `fetchScreen`.
`R` is whatever your UI layer renders (a React element, a DOM node...), so the same core serves
web, React Native and server-side rendering.

```ts
// ProfileHeaderV2 is generated from the island manifest by codegen/.
const registry = new IslandRegistry<ReactNode>()
  .register(ProfileHeaderV2, (props) => <ProfileHeader {...props} />);

const response = await fetchScreen(baseUrl, buildRequest(registry, "profile", { platform: "web", appVersion }, { userId }));
const islands = plan(registry, response, { onSkipped: (e, reason) => console.warn(e.key, reason) });
// islands.map((i) => <Fragment key={i.key}>{i.render()}</Fragment>)
```

Props aren't validated at runtime, so the `typedOnly` conformance cases don't apply.

**Planned:** a React / React Native binding (`<ComposedScreen>`).

## Tests

```sh
pnpm test   # from the repo root; runs the shared client conformance fixtures
```
