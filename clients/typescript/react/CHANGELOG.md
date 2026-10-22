# @client-compose/react

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
