# @client-compose/composer

## 0.14.0

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

## 0.13.0

### Minor Changes

- [#51](https://github.com/client-compose/client-compose/pull/51) [`f9db680`](https://github.com/client-compose/client-compose/commit/f9db680e2e5d9df2030f00f65da6674fc412280d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screen strings outside a request: `stringsFor(config, locale).strings(InviteScreenStrings)` reads a
  screen's strings, typed by their generated descriptor, for words a composer sends outside any
  request, such as an email or a notification.

## 0.12.0

### Minor Changes

- [#47](https://github.com/client-compose/client-compose/pull/47) [`fb57f76`](https://github.com/client-compose/client-compose/commit/fb57f7604155f07b8257888fbf8832d79805f9d8) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Actions read screen strings (spec §4.7), for words their results carry: `ac.strings(descriptor)` in
  TypeScript, and in Go `call.ScreenStrings(screen)`, or the generated `XScreenStringsFor(call)`, which
  now takes a Request or a Call (`cc.ScreenStringsSource`).

## 0.11.0

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

## 0.10.0

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

## 0.9.0

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

- Updated dependencies [[`b53f2d8`](https://github.com/client-compose/client-compose/commit/b53f2d8c65c4d64b42de7109da19ab037c348a4b)]:
  - @client-compose/protocol@0.4.0

## 0.7.0

### Minor Changes

- [#26](https://github.com/client-compose/client-compose/pull/26) [`4435c94`](https://github.com/client-compose/client-compose/commit/4435c942acfe8bc37485f7defe6b2dd4d6b58816) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - An optional cache adapter (CMP-18). Give the composer a `cache` (your own `get`/`set`, over Redis or
  anything else) and islands opting in with `island(Descriptor, resolve, { cache: { ttlMs, key } })`
  are served from it while fresh. Without a cache, nothing changes. Failures are never cached, and a
  cache that errors is reported (`kind: "cache"`) and bypassed. `memoryCache()` in
  `@client-compose/composer/testing` is an in-memory one for tests.

- [#27](https://github.com/client-compose/client-compose/pull/27) [`4df6813`](https://github.com/client-compose/client-compose/commit/4df6813fe5b31734b6769c804f871646c06866a4) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - An optional idempotency adapter (CMP-19). Give the composer `idempotency: { store, scope }` (your own
  `begin`/`finish`/`release`, over Redis or anything else) and it honours action idempotency keys: a
  retry returns the first outcome instead of running again, a duplicate in flight waits for it, and
  failures release the key. Without it, keys pass through to actions as before.
  `memoryIdempotencyStore()` in `@client-compose/composer/testing` is an in-memory one for tests.

## 0.6.0

### Minor Changes

- [#18](https://github.com/client-compose/client-compose/pull/18) [`9eadbcf`](https://github.com/client-compose/client-compose/commit/9eadbcf16ad2374e8ff1376fe0b778729b73a89e) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - **Breaking:** requirements receive the request as well as the context: `(ctx, { screen, params, client })`.
  A screen can now require that what its params refer to exists and that the viewer may see it, and
  answer 404 or 403 without a layout function. `reportErrors` returns a plain plugin, so it fits any
  composer without type arguments.

## 0.5.0

### Minor Changes

- [#16](https://github.com/client-compose/client-compose/pull/16) [`d736b2f`](https://github.com/client-compose/client-compose/commit/d736b2ff986f36257d40775e9ee55b7423f81c61) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - **Breaking:** one declarative composer, with requirements, plugins, a fetch handler and a test kit.
  
  - `createComposer({ screens, actions, context, use, defaultTimeoutMs })` replaces
    `createComposer(screens, options)` and `createActions(actions, options)`. It returns a composer with
    `fetch` (a fetch-standard handler, for Bun, Deno, Workers, Hono and Next.js route handlers),
    `handle` (for adapters), `compose` and `perform` (in-process) and `islands()`.
  - Screens are declared with `screen(id, { islands: [place(key, island, { required, timeoutMs, when })], requires, meta, cache })`.
    `layout` stays for screens decided per request. `placeStatic(key, Descriptor, props)` places an
    island with fixed props. `cacheMaxAge` is now `cache: { maxAge }`.
  - `island(Descriptor, resolve)` replaces `defineIsland`; `action(Descriptor, perform, { requires })`
    replaces `defineAction`; `defineScreen`, `composeHttp` and `performHttp` are gone.
  - `context` turns each request into your app's context. Requirements (`requires`) on screens and
    actions answer 401 or 403 before anything runs, and before input validation.
  - Plugins (`use`) have `context`, `screen`, `island`, `action` and `error` hooks.
    `reportErrors(fn)` replaces `onIslandError`, `onLayoutError`, `onMetaError` and `onActionError`.
  - `@client-compose/composer/testing`: `testComposer(composer)` calls it in-process with typed
    screens, props and action outcomes.
  - Batch loaders gain `loadMany`. The composer re-exports the protocol's types.
  - `@client-compose/node-http`: `createRequestListener(composer)` takes the composer alone; its
    `context` receives the `IncomingMessage`.

## 0.4.0

### Minor Changes

- [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Actions (spec §5): `defineAction`, `createActions` and `performHttp`. Input is validated against the action's manifest, declared errors are typed outcomes, and effects tell clients which screens changed. `UnauthenticatedError` and `ForbiddenError` respond 401 / 403 from layouts and actions. `conformanceActions()` for conformance servers.

### Patch Changes

- Updated dependencies [[`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d)]:
  - @client-compose/protocol@0.3.0

## 0.3.0

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

## 0.2.0

### Minor Changes

- [`55613c9`](https://github.com/client-compose/client-compose/commit/55613c91f661064f9856b1654c08c47a697a64f4) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Request-scoped data loading. `rc.load(key, fn)` (on resolver and layout contexts) runs `fn` once per
  key per screen request and shares the result with every island and the layout; the work runs under
  the request's signal, so an island timing out never cancels work other islands are waiting on, and
  whatever is still running is cancelled once the response is ready. `defineBatchLoader` combines and
  de-duplicates keys requested by different islands into one call. Also exports `LayoutContext`.

## 0.1.1

### Patch Changes

- [`6450b20`](https://github.com/client-compose/client-compose/commit/6450b200376621726878680fc713b72709538067) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - README: import `composeHttp` in the framework adapter example.

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).

### Patch Changes

- Updated dependencies [[`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6)]:
  - @client-compose/protocol@0.1.0
