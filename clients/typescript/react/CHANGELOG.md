# @client-compose/react

## 0.11.1

### Patch Changes

- Updated dependencies [[`70ff47c`](https://github.com/client-compose/client-compose/commit/70ff47c0a7b511db17586f34819a2ab472350792)]:
  - @client-compose/protocol@0.7.0
  - @client-compose/client@0.10.0

## 0.11.0

### Minor Changes

- [#41](https://github.com/client-compose/client-compose/pull/41) [`669292e`](https://github.com/client-compose/client-compose/commit/669292ebbd0bfa3b647b7b91ad6e9ff688ebc7fc) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Strings (spec §4.7). Every word an app shows comes from the composer, in the client's language, so
  copy changes, and languages are added, without an app release.
  
  - Protocol: island manifests declare `strings` (keys, their `params`, and `counted`), and an app
    strings manifest the words outside any island. An island entry carries its `strings`; the head,
    and an island response with strings, carry `locale` and `plurals` (CLDR's plural rules, for
    whole numbers). `POST /strings` answers the app strings. Templates fill in `{name}`; counted
    strings have variants keyed `#<n>`, `#<category>` or `#*`.
  - Composer: `strings: { catalog: loadCatalog("strings"), defaultLocale }`, one JSON file per
    language. The nearest language is chosen (`pl-PL`, then `pl`, then the default), string by
    string. `/strings` runs without `context`. `testComposer` gains `strings()`.
  - Adapters serve `/strings` (Fastify registers the route).
  - Client: an island registered by a descriptor with strings gets its props with `t`;
    `fetchStrings`, `appStrings`, `formatString`, `pluralCategory`; `proxy.loadStrings`. The fake
    composer answers `strings`, and `island(…, { strings })`, `stringsResponse` and the screen
    builders' language build responses.
  - React: `registerComponent` types the component's `t`; a Client Component rendered by a Server
    Component builds its `t` in the browser. `AppStringsProvider` (with a `cache`, `loading` and
    `failed`) and `useAppStrings`; `viaProxy({ loadStrings })`; config `loadStrings`.
  - Codegen: typed strings for TypeScript, Swift and Kotlin; `appStrings`, `catalog` and
    `defaultLocale` in the config; compatibility rules for strings; `client-compose-codegen strings`
    checks a catalog against the manifests.
  - Conformance: plural cases from CLDR for 224 languages and template cases for clients;
    strings cases and a catalog (`conformanceCatalogDir()`) for composers.

### Patch Changes

- Updated dependencies [[`669292e`](https://github.com/client-compose/client-compose/commit/669292ebbd0bfa3b647b7b91ad6e9ff688ebc7fc)]:
  - @client-compose/protocol@0.6.0
  - @client-compose/client@0.9.0

## 0.10.0

### Minor Changes

- [#39](https://github.com/client-compose/client-compose/pull/39) [`4ca4946`](https://github.com/client-compose/client-compose/commit/4ca4946390e582671c75f6b98ed26d780b9e07e4) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screens stream (spec §4.6). A screen is answered as JSON lines (`application/jsonl`): a head, once
  everything that could fail the screen is settled (requirements, layout and conditions, required
  islands, meta), with islands not yet ready marked `pending`; then each of those as it's resolved;
  then an end. Breaking: every screen response is a stream.
  
  - Protocol: `PendingIsland`, `ScreenHead` and `ScreenStreamLine`.
  - Composer: a successful `compose` result's body is a `ScreenStream` (`head`, and `islands` as they
    come); `collect` puts one together. `handle` answers with a `contentType` and a body that's a
    string or, for a screen, its lines as an async iterable. `testComposer` screens have a `head`.
  - Adapters (node:http, Express, Fastify) send each line as it's ready. Fastify now registers the
    island request route too.
  - Client: `openScreen` resolves with a screen's head and then its islands as they arrive;
    `fetchScreen` reads the whole stream; `collectScreen`, `withIsland`, `screenLines`. Placeholders:
    `registry.registerPlaceholder`, which `plan` shows for pending islands. The fake composer streams
    screens, and `streamedScreen` and `pending` let a test say when each island arrives.
  - React: screens render as they stream, by default: `registerComponent(…, { placeholder })`,
    `progressive` in the config and per screen, `streaming` in `useScreen`, and a reload keeps what's
    shown until it's replaced. The Server Component `ComposedScreen` streams pending islands in, each
    in its own `<Suspense>` with its placeholder, and takes a `stream` from `streamScreen` (to share
    with `generateMetadata`). `viaProxy` answers screens as streams.
  - Conformance: screen responses are checked as streams (`expect.pending`, `expect.resolved`); mocks
    take `startDelayMs`; client fixtures are streams, with cases for putting one together, islands
    that never arrive, and lines to ignore.

### Patch Changes

- Updated dependencies [[`4ca4946`](https://github.com/client-compose/client-compose/commit/4ca4946390e582671c75f6b98ed26d780b9e07e4)]:
  - @client-compose/protocol@0.5.0
  - @client-compose/client@0.8.0

## 0.9.0

### Minor Changes

- [#37](https://github.com/client-compose/client-compose/pull/37) [`37bd8f6`](https://github.com/client-compose/client-compose/commit/37bd8f6849b47ad5e8d9d00b7f04ac57f5bfa69c) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `pagedIsland` in `@client-compose/react/testing`: a paged island on a screen of its own, with the
  fake composer's answers for the screen and its pages, for testing islands that use `usePages`.

## 0.8.0

### Minor Changes

- [#34](https://github.com/client-compose/client-compose/pull/34) [`b53f2d8`](https://github.com/client-compose/client-compose/commit/b53f2d8c65c4d64b42de7109da19ab037c348a4b) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Island requests (spec §4.5): an island's next page, and refreshing one island. An island entry may
  carry `next`, an opaque cursor; `POST /screens/{screen}/islands/{key}` resolves that one island
  again, for the page a cursor asks for or from its first page.
  
  - Protocol: `IslandRequest`, `IslandResponse`, and `next` on island entries.
  - Composer: `pagedIsland`, `rc.cursor`, `InvalidCursorError`, `composeIsland`, and island requests in
    `testComposer` (`island`, `nextPage`, `next`).
  - Client: `buildIslandRequest`, `fetchIsland` (which throws `IslandFetchError` when the request
    fails), `proxy.loadIsland`, and island handlers in the fake composer (`islands`,
    `islandResponse`, `island(…, next)`).
  - React: `usePages`, `loadIsland` in the config (to fetch pages another way), and `viaProxy`'s
    `loadIsland`. `ClientComposeProvider` and `usePages` live in their own client modules.
  - Conformance: island cases (`islandCases`, `runIslandCase`), paged mocks, and a client fixture for
    `next`.

### Patch Changes

- Updated dependencies [[`b53f2d8`](https://github.com/client-compose/client-compose/commit/b53f2d8c65c4d64b42de7109da19ab037c348a4b), [`b53f2d8`](https://github.com/client-compose/client-compose/commit/b53f2d8c65c4d64b42de7109da19ab037c348a4b)]:
  - @client-compose/client@0.7.0
  - @client-compose/protocol@0.4.0

## 0.7.0

### Minor Changes

- [#20](https://github.com/client-compose/client-compose/pull/20) [`8aa8135`](https://github.com/client-compose/client-compose/commit/8aa8135521b28b724f9d699a9c9f9b2ea526efb9) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Client conformance fixtures for actions and effects (`clientActionCases()`), and the TypeScript
  client now passes them:
  
  - An error code the action doesn't declare, such as one added after the app was built, is a
    failure (spec §5.1): `callAction` throws `ActionFetchError` with that code, and `useAction` ends
    with `{ status: "failed" }`. It used to be returned as if it were a declared error.
  - A body that isn't JSON, or isn't an outcome, is an `ActionFetchError` rather than a `SyntaxError`.
  - New `checkActionResponse(action, response)`, for transports of your own.

### Patch Changes

- Updated dependencies [[`8aa8135`](https://github.com/client-compose/client-compose/commit/8aa8135521b28b724f9d699a9c9f9b2ea526efb9)]:
  - @client-compose/client@0.6.0

## 0.6.1

### Patch Changes

- [#16](https://github.com/client-compose/client-compose/pull/16) [`d736b2f`](https://github.com/client-compose/client-compose/commit/d736b2ff986f36257d40775e9ee55b7423f81c61) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Tighter types: `IslandRenderer` and island entries default their props to `unknown` instead of
  `any`, and `registerComponent` takes props that are objects (as generated props types are).
- Updated dependencies [[`d736b2f`](https://github.com/client-compose/client-compose/commit/d736b2ff986f36257d40775e9ee55b7423f81c61)]:
  - @client-compose/client@0.5.1

## 0.6.0

### Minor Changes

- [#12](https://github.com/client-compose/client-compose/pull/12) [`f07f193`](https://github.com/client-compose/client-compose/commit/f07f193938f4862a7354da8c4d40d7ed5d8ade7e) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Send screens and actions through your own server. `@client-compose/client/proxy`'s `createComposerProxy` is the server half (e.g. inside Next.js Server Actions): it checks what the browser sent, sets the client context and headers (such as a session from an httpOnly cookie), lets you see and change each action's response, and returns failures as data. `viaProxy` in `@client-compose/react` is the browser half: it turns those functions into the config's `fetch` and `performAction`.
  
  `installFakeGateway(handlers)` in `@client-compose/client/testing` (and `@client-compose/react/testing`) installs the fake composer as the global `fetch`, for code that fetches by itself; `restore()` puts the original back.

### Patch Changes

- Updated dependencies [[`f07f193`](https://github.com/client-compose/client-compose/commit/f07f193938f4862a7354da8c4d40d7ed5d8ade7e)]:
  - @client-compose/client@0.5.0

## 0.5.0

### Minor Changes

- [#10](https://github.com/client-compose/client-compose/pull/10) [`1689cf4`](https://github.com/client-compose/client-compose/commit/1689cf4cdedf27677171f3c88b75252cfd472752) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Testing helpers and action error helpers.
  
  - `@client-compose/client/testing`: `createFakeGateway`, a fake composer that answers screen and action requests from handlers and records them, and response builders typed by generated descriptors (`island`, `islandError`, `screen`, `screenError`, `actionOk`, `actionError`, `actionFailure`).
  - `@client-compose/react/testing`: everything above, plus `createTestConfig`, a provider config for tests that uses the fake composer and records `navigate` and `invalidate` effects.
  - `@client-compose/react`: `declaredError(result)` and `isUnexpected(result, handled)` for showing how an action call ended.

### Patch Changes

- Updated dependencies [[`1689cf4`](https://github.com/client-compose/client-compose/commit/1689cf4cdedf27677171f3c88b75252cfd472752)]:
  - @client-compose/client@0.4.0

## 0.4.1

### Patch Changes

- [`739da6b`](https://github.com/client-compose/client-compose/commit/739da6b50ca722acdbc84abb525e5bd3ceef533c) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Re-export `ActionRequest`, the type a custom `performAction` receives.

## 0.4.0

### Minor Changes

- [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `useAction` performs actions (spec §5) and applies their effects: invalidated screens shown with `useScreen` / `ComposedScreen` reload and their cached responses are dropped, and the new `onInvalidate` / `onNavigate` config callbacks let apps refresh Server Components and route. `performAction` in the config sends action requests another way (e.g. through a Next.js Server Action).

### Patch Changes

- Updated dependencies [[`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d), [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d)]:
  - @client-compose/client@0.3.0
  - @client-compose/protocol@0.3.0

## 0.3.0

### Minor Changes

- [`dae1216`](https://github.com/client-compose/client-compose/commit/dae12167859425424f1475a4c2f1f83e404f8169) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - The Server Component `ComposedScreen` accepts a `response` (or promise of one) already loaded with
  `loadScreen`, and renders it without fetching. Lets a page share one request between
  `generateMetadata` and the screen (with React's `cache()`).

## 0.2.1

### Patch Changes

- [`4e7aae0`](https://github.com/client-compose/client-compose/commit/4e7aae086212b9b0bb21944d51462d83f6f8ceef) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screen `meta` and `not_found` (spec §4, §4.3):
  
  - Responses can carry optional `meta` (`title`, `description`, `image`) describing the screen as a
    whole, from a screen's new `meta` function, which runs alongside the islands and shares their loads.
  - A layout throwing `NotFoundError` (or a batch loader's missing key) responds 404 `not_found`,
    distinct from `unknown_screen`. `ScreenFetchError` now exposes the protocol error `code`.
  - New `onLayoutError` and `onMetaError` composer options; two new conformance cases.
  - `@client-compose/react` re-exports `ScreenMeta`.
- Updated dependencies [[`4e7aae0`](https://github.com/client-compose/client-compose/commit/4e7aae086212b9b0bb21944d51462d83f6f8ceef)]:
  - @client-compose/protocol@0.2.0
  - @client-compose/client@0.2.0

## 0.2.0

### Minor Changes

- [`d22fde3`](https://github.com/client-compose/client-compose/commit/d22fde33c08ad5d4fd6ec3004971740e55a7e63a) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Server rendering and React Server Components support:
  
  - New `@client-compose/react/server` entry with an async Server Component `ComposedScreen`.
  - The main entry is now safe to import from Server Components: hooks and components live in a
    `"use client"` module, and the registry and new `loadScreen` work anywhere.
  - `loadScreen` plus a new `initialResponse` option on `useScreen` and `<ComposedScreen>`: render
    server-fetched islands into the HTML and hydrate without refetching. A new `initialResponse`
    from a navigation or refresh is used without a browser request.
  - Each island now also gets its own `<Suspense>` boundary, so an island that throws during server
    rendering renders as nothing instead of replacing the whole screen with its fallback.
  - Re-exports the `IslandDescriptor` and `ScreenResponse` types, so React apps (and codegen output
    with `"protocolImport": "@client-compose/react"`) only need this package.

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).

### Patch Changes

- Updated dependencies [[`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6)]:
  - @client-compose/protocol@0.1.0
  - @client-compose/client@0.1.0
