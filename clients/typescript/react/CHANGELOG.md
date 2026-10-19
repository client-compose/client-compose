# @client-compose/react

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
