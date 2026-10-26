# @client-compose/composer

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
