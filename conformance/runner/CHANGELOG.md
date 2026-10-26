# @client-compose/conformance

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
