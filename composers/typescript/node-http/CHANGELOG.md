# @client-compose/node-http

## 0.3.2

### Patch Changes

- Updated dependencies [[`4435c94`](https://github.com/client-compose/client-compose/commit/4435c942acfe8bc37485f7defe6b2dd4d6b58816), [`4df6813`](https://github.com/client-compose/client-compose/commit/4df6813fe5b31734b6769c804f871646c06866a4)]:
  - @client-compose/composer@0.7.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`9eadbcf`](https://github.com/client-compose/client-compose/commit/9eadbcf16ad2374e8ff1376fe0b778729b73a89e)]:
  - @client-compose/composer@0.6.0

## 0.3.0

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

### Patch Changes

- Updated dependencies [[`d736b2f`](https://github.com/client-compose/client-compose/commit/d736b2ff986f36257d40775e9ee55b7423f81c61)]:
  - @client-compose/composer@0.5.0

## 0.2.0

### Minor Changes

- [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `createRequestListener(compose, context, { actions })` also serves `POST /actions/{action}`.

### Patch Changes

- Updated dependencies [[`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d)]:
  - @client-compose/composer@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [[`4e7aae0`](https://github.com/client-compose/client-compose/commit/4e7aae086212b9b0bb21944d51462d83f6f8ceef)]:
  - @client-compose/composer@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`55613c9`](https://github.com/client-compose/client-compose/commit/55613c91f661064f9856b1654c08c47a697a64f4)]:
  - @client-compose/composer@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`6450b20`](https://github.com/client-compose/client-compose/commit/6450b200376621726878680fc713b72709538067)]:
  - @client-compose/composer@0.1.1

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).

### Patch Changes

- Updated dependencies [[`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6)]:
  - @client-compose/composer@0.1.0
