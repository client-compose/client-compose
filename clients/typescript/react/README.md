# @client-compose/react

React and React Native bindings for [Client Compose](https://github.com/client-compose/client-compose):
a protocol for server-composed screens made of client-owned islands.

Tier: **core** · Protocol: **v0** · React 18+ · Works with **React DOM and React Native**

```sh
npm install @client-compose/react
```

`@client-compose/react` uses only React itself: no DOM APIs and no wrapper elements. The same
package and the same registry pattern work on the web, on iOS and Android via React Native, and
with any other React renderer.

## Register island components

Island props types come from [`@client-compose/codegen`](https://www.npmjs.com/package/@client-compose/codegen). `registerComponent` renders the
component as an element, so island components can use hooks.

```tsx
import { ReactIslandRegistry } from "@client-compose/react";
import { FollowButtonV1, ProfileHeaderV2 } from "./islands.generated";

export const registry = new ReactIslandRegistry()
  .registerComponent(ProfileHeaderV2, ProfileHeader) // ProfileHeader: (props: ProfileHeaderV2) => ReactNode
  .registerComponent(FollowButtonV1, FollowButton);
```

## Provide a config

```tsx
<ClientComposeProvider
  config={{
    registry,
    baseUrl: "https://api.example.com/compose",
    client: { platform: "web", appVersion: "1.4.0" },
    headers: async () => ({ Authorization: `Bearer ${await getToken()}` }),
    onSkipped: (entry, reason) => log("island skipped", entry.key, reason),
    onRenderError: (key, error) => report(error, { island: key }),
  }}
>
  <App />
</ClientComposeProvider>
```

Memoise the config (`useMemo`) if you build it inside a component, because a new config object refetches.

## Render a screen

**`<ComposedScreen>`** fetches a screen and renders its islands in order:

```tsx
<ComposedScreen
  screen="profile"
  params={{ userId }}
  loading={<Spinner />}
  renderError={(error, reload) => <Retry onPress={reload} />}
>
  {(islands) => <main className="profile">{islands}</main>}  {/* optional; default: no wrapper */}
</ComposedScreen>
```

**`useScreen` + `<Island>`** gives you full control over layout, e.g. a React Native `FlatList` with
pull-to-refresh:

```tsx
const screen = useScreen("profile", { userId });
if (screen.status === "loading") return <ActivityIndicator />;
if (screen.status === "error") return <Retry onPress={screen.reload} />;
return (
  <FlatList
    data={screen.islands}
    keyExtractor={(island) => island.key}
    renderItem={({ item }) => <Island island={item} />}
    refreshing={screen.refreshing}
    onRefresh={screen.reload}
  />
);
```

`useScreen` returns `{ status, islands, response, error, refreshing, reload }`. After the first
response, a failed reload keeps the current islands (`status: "ready"` with `error` set).

## Behaviour

- **Per-island crash isolation.** Each island renders inside its own error boundary. A component
  that throws hides only that island and calls `onRenderError`; the rest of the screen stays.
- **Errored islands** (the composer's `status: "error"`) are omitted unless you set
  `renderIslandError`.
- **Unknown islands** (type, version or status this app doesn't know) are skipped and reported
  through `onSkipped`.
- **Caching.** Responses are reused for the composer's `cache.maxAge`, per provider, keyed by
  screen and params. Returning to a screen renders immediately without a request.
  `reload()` always refetches. Set `cache: false` to turn this off.
- **Params** can be a new object each render; requests are keyed by their contents.
- **Requests are cancelled** when the screen or params change, or the component unmounts.

## Examples

- [`examples/profile/web`](https://github.com/client-compose/client-compose/tree/main/examples/profile/web): Vite + React DOM
- [`examples/profile/react-native`](https://github.com/client-compose/client-compose/tree/main/examples/profile/react-native): Expo + React Native
