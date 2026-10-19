# @client-compose/conformance

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
