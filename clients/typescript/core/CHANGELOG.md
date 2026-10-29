# @client-compose/client

## 0.16.0

### Minor Changes

- [#66](https://github.com/client-compose/client-compose/pull/66) [`1c430ed`](https://github.com/client-compose/client-compose/commit/1c430ed3234f774a4f7de96e973bbd785793f73d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `registry.declare(...descriptors)` names islands the app renders somewhere else, such as Server Components rendered on the server: actions say the app can draw them, and changes to their entities apply to them, though the registry can't render them.

## 0.15.0

### Minor Changes

- [#53](https://github.com/client-compose/client-compose/pull/53) [`9845e52`](https://github.com/client-compose/client-compose/commit/9845e52531ae846004c9771db95774207f5adae0) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `heldEntities(props, paths)`: the entities an island's props hold, at its descriptor's entity paths.

### Patch Changes

- Updated dependencies [[`9845e52`](https://github.com/client-compose/client-compose/commit/9845e52531ae846004c9771db95774207f5adae0)]:
  - @client-compose/protocol@0.9.0

## 0.14.0

### Minor Changes

- [#59](https://github.com/client-compose/client-compose/pull/59) [`c0c1d6e`](https://github.com/client-compose/client-compose/commit/c0c1d6e58dcb6cb60ed964e0cf5e012dde990e64) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - React applies an action's entity changes and island updates (spec §5.3): to every screen on show,
  cached screens, and every page a paged island holds, without fetching; a screen that can't take
  them reloads. The registry knows where each island holds entities, from its descriptor.

## 0.13.0

### Minor Changes

- [#56](https://github.com/client-compose/client-compose/pull/56) [`55523ae`](https://github.com/client-compose/client-compose/commit/55523ae95da521bc7bb787149857319a2a15b394) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - React applies an action's entity changes and island updates (spec §5.3): to every screen on show,
  cached screens, and every page a paged island holds, without fetching; a screen that can't take
  them reloads. The registry knows where each island holds entities, from its descriptor.

## 0.12.0

### Minor Changes

- [#55](https://github.com/client-compose/client-compose/pull/55) [`bb8e4b2`](https://github.com/client-compose/client-compose/commit/bb8e4b2b8565a833e4c40b6ef92a095b01916283) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Entity changes and island updates (spec §2.1, §5.3), so actions don't reload whole screens.
  
  - **Codegen** reads entity manifests (`"entities"`), checks the objects islands mark with `entity`,
    and generates entity types and, on island descriptors, where they hold entities.
  - **Composers:** an action returns `changes` (`changed(TodoEntity, id, { … })`,
    `deleted(TodoEntity, id)`) and names islands to `update`, which the composer resolves again, in
    a fresh scope, at the client's versions, invalidating the screen when it can't. The test kit's
    `checkEffects` compares an action's effects with a fresh resolve.
  - **Clients** send their `islands` with every action request (now required), and
    `applyChanges` applies entity changes to an island's props. The React binding applies them next.

### Patch Changes

- Updated dependencies [[`bb8e4b2`](https://github.com/client-compose/client-compose/commit/bb8e4b2b8565a833e4c40b6ef92a095b01916283)]:
  - @client-compose/protocol@0.8.0

## 0.11.0

### Minor Changes

- [#49](https://github.com/client-compose/client-compose/pull/49) [`d284aaa`](https://github.com/client-compose/client-compose/commit/d284aaa866472b12ca9b2ae421d97ad04357d9db) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Strings, easier to use. `IslandProps<typeof RecipeListV1>` types an island's component (its props,
  with `t` when it declares strings). `preferredLocale` picks `client.locale` from a device's tags or an
  Accept-Language header. React adds `richText`, to put links into a sentence, and `useLocale()`. For
  React Server Components, `serverComposer` asks for a request's screens and app strings once, however
  many components ask. For tests, `catalogStrings(catalog)` reads a catalog file as the composer would
  send it.

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

### Patch Changes

- Updated dependencies [[`70ff47c`](https://github.com/client-compose/client-compose/commit/70ff47c0a7b511db17586f34819a2ab472350792)]:
  - @client-compose/protocol@0.7.0

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

### Patch Changes

- Updated dependencies [[`669292e`](https://github.com/client-compose/client-compose/commit/669292ebbd0bfa3b647b7b91ad6e9ff688ebc7fc)]:
  - @client-compose/protocol@0.6.0

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

### Patch Changes

- Updated dependencies [[`4ca4946`](https://github.com/client-compose/client-compose/commit/4ca4946390e582671c75f6b98ed26d780b9e07e4)]:
  - @client-compose/protocol@0.5.0

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

### Patch Changes

- [#34](https://github.com/client-compose/client-compose/pull/34) [`b53f2d8`](https://github.com/client-compose/client-compose/commit/b53f2d8c65c4d64b42de7109da19ab037c348a4b) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `fetchScreen`, `fetchAction`, `fetchIsland` and `createComposerProxy` keep headers given as a
  `Headers` object or as pairs, instead of dropping them, and send `content-type: application/json`
  unless the caller sets their own.
- Updated dependencies [[`b53f2d8`](https://github.com/client-compose/client-compose/commit/b53f2d8c65c4d64b42de7109da19ab037c348a4b)]:
  - @client-compose/protocol@0.4.0

## 0.6.0

### Minor Changes

- [#20](https://github.com/client-compose/client-compose/pull/20) [`8aa8135`](https://github.com/client-compose/client-compose/commit/8aa8135521b28b724f9d699a9c9f9b2ea526efb9) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Client conformance fixtures for actions and effects (`clientActionCases()`), and the TypeScript
  client now passes them:
  
  - An error code the action doesn't declare, such as one added after the app was built, is a
    failure (spec §5.1): `callAction` throws `ActionFetchError` with that code, and `useAction` ends
    with `{ status: "failed" }`. It used to be returned as if it were a declared error.
  - A body that isn't JSON, or isn't an outcome, is an `ActionFetchError` rather than a `SyntaxError`.
  - New `checkActionResponse(action, response)`, for transports of your own.

## 0.5.1

### Patch Changes

- [#16](https://github.com/client-compose/client-compose/pull/16) [`d736b2f`](https://github.com/client-compose/client-compose/commit/d736b2ff986f36257d40775e9ee55b7423f81c61) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Tighter types: `IslandRenderer` and island entries default their props to `unknown` instead of
  `any`, and `registerComponent` takes props that are objects (as generated props types are).

## 0.5.0

### Minor Changes

- [#12](https://github.com/client-compose/client-compose/pull/12) [`f07f193`](https://github.com/client-compose/client-compose/commit/f07f193938f4862a7354da8c4d40d7ed5d8ade7e) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Send screens and actions through your own server. `@client-compose/client/proxy`'s `createComposerProxy` is the server half (e.g. inside Next.js Server Actions): it checks what the browser sent, sets the client context and headers (such as a session from an httpOnly cookie), lets you see and change each action's response, and returns failures as data. `viaProxy` in `@client-compose/react` is the browser half: it turns those functions into the config's `fetch` and `performAction`.
  
  `installFakeGateway(handlers)` in `@client-compose/client/testing` (and `@client-compose/react/testing`) installs the fake composer as the global `fetch`, for code that fetches by itself; `restore()` puts the original back.

## 0.4.0

### Minor Changes

- [#10](https://github.com/client-compose/client-compose/pull/10) [`1689cf4`](https://github.com/client-compose/client-compose/commit/1689cf4cdedf27677171f3c88b75252cfd472752) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Testing helpers and action error helpers.
  
  - `@client-compose/client/testing`: `createFakeGateway`, a fake composer that answers screen and action requests from handlers and records them, and response builders typed by generated descriptors (`island`, `islandError`, `screen`, `screenError`, `actionOk`, `actionError`, `actionFailure`).
  - `@client-compose/react/testing`: everything above, plus `createTestConfig`, a provider config for tests that uses the fake composer and records `navigate` and `invalidate` effects.
  - `@client-compose/react`: `declaredError(result)` and `isUnexpected(result, handled)` for showing how an action call ended.

## 0.3.0

### Minor Changes

- [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Actions (spec §5): `callAction` performs an action with its generated descriptor and resolves with its typed outcome; `ActionFetchError` for non-2xx responses; `buildActionRequest`, `fetchAction` and `newIdempotencyKey`.

### Patch Changes

- Updated dependencies [[`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d)]:
  - @client-compose/protocol@0.3.0

## 0.2.0

### Minor Changes

- [`4e7aae0`](https://github.com/client-compose/client-compose/commit/4e7aae086212b9b0bb21944d51462d83f6f8ceef) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screen `meta` and `not_found` (spec §4, §4.3):
  
  - Responses can carry optional `meta` (`title`, `description`, `image`) describing the screen as a
    whole, from a screen's new `meta` function, which runs alongside the islands and shares their loads.
  - A layout throwing `NotFoundError` (or a batch loader's missing key) responds 404 `not_found`,
    distinct from `unknown_screen`. `ScreenFetchError` now exposes the protocol error `code`.
  - New `onLayoutError` and `onMetaError` composer options; two new conformance cases.
  - `@client-compose/react` re-exports `ScreenMeta`.

### Patch Changes

- Updated dependencies [[`4e7aae0`](https://github.com/client-compose/client-compose/commit/4e7aae086212b9b0bb21944d51462d83f6f8ceef)]:
  - @client-compose/protocol@0.2.0

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).

### Patch Changes

- Updated dependencies [[`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6)]:
  - @client-compose/protocol@0.1.0
