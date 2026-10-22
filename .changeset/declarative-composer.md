---
"@client-compose/composer": minor
"@client-compose/node-http": minor
---

**Breaking:** one declarative composer, with requirements, plugins, a fetch handler and a test kit.

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
