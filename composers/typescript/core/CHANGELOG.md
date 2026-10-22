# @client-compose/composer

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
