# @client-compose/react

React and React Native bindings for [Client Compose](https://github.com/client-compose/client-compose):
a protocol for server-composed screens made of client-owned islands.

Tier: **core** · Protocol: **v0** · React 18+ · Works with **React DOM, React Native, server
rendering and React Server Components**

```sh
npm install @client-compose/react
```

`@client-compose/react` uses only React itself: no DOM APIs and no wrapper elements. The same
package and the same registry pattern work on the web, on iOS and Android via React Native, and
with any other React renderer, rendering on the client, the server, or in Server Components:

| Rendering | Use | Data is fetched |
| --- | --- | --- |
| Client only (Vite, CRA, React Native) | `<ClientComposeProvider>` + `<ComposedScreen>` or `useScreen` | in the browser / app |
| Server rendering (Remix / React Router, Next.js Pages Router, Express + `renderToString`) | `loadScreen` in your loader, then `initialResponse` | on the server; the client hydrates without refetching |
| React Server Components (Next.js App Router) | `ComposedScreen` from `@client-compose/react/server` | on the server; islands render there |

## Register island components

Island props types come from [`@client-compose/codegen`](https://www.npmjs.com/package/@client-compose/codegen)
(set `"protocolImport": "@client-compose/react"` in its TypeScript target so the generated file only
needs this package). `registerComponent` renders the component as an element, so island components
can use hooks.

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

## Server rendering

Fetch the screen in your loader with `loadScreen`, and pass the response to `<ComposedScreen>` (or
`useScreen`) as `initialResponse`. The server renders the islands into the HTML, and the client
hydrates without fetching again. The response is plain JSON, so loaders can return it as-is.

```tsx
// e.g. a React Router / Remix loader
export async function loader({ params, request }) {
  return { screen: await loadScreen(serverConfig(request), "profile", { userId: params.userId }) };
}

export default function Profile() {
  const { screen } = useLoaderData<typeof loader>();
  const { userId } = useParams();
  return <ComposedScreen screen="profile" params={{ userId }} initialResponse={screen} />;
}
```

`loadScreen(config, screen, params)` takes the same config as the provider (`registry`, `baseUrl`,
`client`, `headers`, …), so on the server you can read auth from the incoming request. When your
framework re-runs the loader (navigation, revalidation), the new `initialResponse` is used without a
browser request; params with no server response are fetched from the browser as usual.

## React Server Components

`@client-compose/react/server` exports an async Server Component. The screen is fetched and its
islands rendered on the server; islands can be Server Components (no client JavaScript) or Client
Components (files marked `"use client"`).

```tsx
// app/profile/[userId]/page.tsx
import { ComposedScreen } from "@client-compose/react/server";

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <ComposedScreen
      config={{
        registry,
        baseUrl: process.env.COMPOSER_URL!,
        client: { platform: "web", appVersion: "1.4.0" },
        headers: async () => ({ Authorization: `Bearer ${await tokenFromCookies()}` }),
        requestInit: { cache: "no-store" }, // personalised screens: don't share Next's fetch cache
      }}
      screen="profile"
      params={{ userId }}
      fallback={<Spinner />}        // streamed while loading; omit to use your loading.tsx
      renderError={() => <Oops />}  // omit to throw to error.tsx
    />
  );
}
```

- Import the registry module from Server Components; it has no hooks, so it's safe there. The
  package's main entry is also safe to import from Server Components: its hooks and components
  live in a `"use client"` module.
- `requestInit` is passed to every request, so framework fetch options such as
  `{ next: { revalidate: 30 } }` work too.
- To refresh, use your framework's mechanism (e.g. `router.refresh()`).
- If the page also needs the response (e.g. its `meta` in Next.js's `generateMetadata`), load it
  once and pass it in, so the component doesn't fetch again:

  ```tsx
  const getScreen = cache((id: string) => loadScreen(config, "recipe", { recipeId: id }));

  export async function generateMetadata({ params }) {
    const { meta } = await getScreen((await params).recipeId);
    return { title: meta?.title, description: meta?.description };
  }

  export default async function Page({ params }) {
    const { recipeId } = await params;
    return <ComposedScreen config={config} screen="recipe" params={{ recipeId }} response={getScreen(recipeId)} />;
  }
  ```
- `onRenderError` in this config sees errors thrown while creating an island's element on the
  server. Errors thrown inside a Server Component island are re-thrown in the browser and caught
  there; to report those, put a `<ClientComposeProvider>` with `onRenderError` above the page.

## Behaviour

- **Per-island crash isolation.** Each island renders inside its own error boundary and its own
  `<Suspense>`. A component that throws hides only that island and calls `onRenderError`; the
  rest of the screen stays. During server rendering (where React ignores error boundaries) the
  island renders as nothing and recovers in the browser, instead of taking the screen down.
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
- [`examples/profile/next`](https://github.com/client-compose/client-compose/tree/main/examples/profile/next): Next.js App Router, with both a Server Components route and
  a server-rendered `initialResponse` route
- [`examples/profile/react-native`](https://github.com/client-compose/client-compose/tree/main/examples/profile/react-native): Expo + React Native
