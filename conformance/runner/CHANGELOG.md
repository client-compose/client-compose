# @client-compose/conformance

## 0.10.0

### Minor Changes

- [#43](https://github.com/client-compose/client-compose/pull/43) [`70ff47c`](https://github.com/client-compose/client-compose/commit/70ff47c0a7b511db17586f34819a2ab472350792) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screen strings (spec §4.7): a screen's own words, such as its meta's title, which its composer uses
  itself. Declared by screen id in a screen strings manifest (`screenStrings` in the codegen config),
  kept in the catalog under `screens`, and never sent to clients as such.
  
  - Protocol: `ScreenStringsDescriptor`. `formatString`, `pluralCategory` and `buildStrings` move
    here from the client, which still exports them.
  - Composer: `lc.strings(CreatorScreenStrings)` in layouts, conditions, resolvers and meta. Meta
    fields that are empty are left out, as the Go composer does.
  - Codegen: `XScreenStrings` types and descriptors for TypeScript, and for Go
    `XScreenStringsFor(r)` with a method per string; the catalog check covers `screens`.
  - Conformance: a case for a screen's meta from its own strings.

## 0.9.0

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

## 0.8.0

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

## 0.7.0

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

## 0.6.0

### Minor Changes

- [#20](https://github.com/client-compose/client-compose/pull/20) [`8aa8135`](https://github.com/client-compose/client-compose/commit/8aa8135521b28b724f9d699a9c9f9b2ea526efb9) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Client conformance fixtures for actions and effects (`clientActionCases()`), and the TypeScript
  client now passes them:
  
  - An error code the action doesn't declare, such as one added after the app was built, is a
    failure (spec §5.1): `callAction` throws `ActionFetchError` with that code, and `useAction` ends
    with `{ status: "failed" }`. It used to be returned as if it were a declared error.
  - A body that isn't JSON, or isn't an outcome, is an `ActionFetchError` rather than a `SyntaxError`.
  - New `checkActionResponse(action, response)`, for transports of your own.

## 0.5.0

### Minor Changes

- [#16](https://github.com/client-compose/client-compose/pull/16) [`d736b2f`](https://github.com/client-compose/client-compose/commit/d736b2ff986f36257d40775e9ee55b7423f81c61) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `runComposerCase`, `runActionCase` and `runComposerConformance` take an optional `fetch`, so the suite
  can run in-process against a fetch-standard handler such as `composer.fetch`.

## 0.4.0

### Minor Changes

- [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Action conformance cases (`actionCases`, `runActionCase`, also run by `runComposerConformance` and the CLI), the `conformance` action's manifests in `dist/cases/actions/`, screen cases for 401 `unauthenticated` and 403 `forbidden`, and `"$absent"` in expected bodies.

## 0.3.0

### Minor Changes

- [`4e7aae0`](https://github.com/client-compose/client-compose/commit/4e7aae086212b9b0bb21944d51462d83f6f8ceef) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screen `meta` and `not_found` (spec §4, §4.3):
  
  - Responses can carry optional `meta` (`title`, `description`, `image`) describing the screen as a
    whole, from a screen's new `meta` function, which runs alongside the islands and shares their loads.
  - A layout throwing `NotFoundError` (or a batch loader's missing key) responds 404 `not_found`,
    distinct from `unknown_screen`. `ScreenFetchError` now exposes the protocol error `code`.
  - New `onLayoutError` and `onMetaError` composer options; two new conformance cases.
  - `@client-compose/react` re-exports `ScreenMeta`.

## 0.2.0

### Minor Changes

- [`55613c9`](https://github.com/client-compose/client-compose/commit/55613c91f661064f9856b1654c08c47a697a64f4) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - New composer cases for request-scoped loading (spec §9): islands that load the same key share one
  call, and an island timing out doesn't cancel a load other islands share. Conformance servers need
  to support the mock `load`, `loadDelayMs` and `startDelayMs` placement fields.

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).
