# @client-compose/codegen

## 0.5.0

### Minor Changes

- [#24](https://github.com/client-compose/client-compose/pull/24) [`79da1c5`](https://github.com/client-compose/client-compose/commit/79da1c514ec047a4b9da6c93e3922f20f2729fa2) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - The Kotlin target generates actions: an `object FollowUserV1 : ActionDescriptor<…>` holding `Input`,
  `Result` and a sealed `Error` with a subclass per declared error.

## 0.4.0

### Minor Changes

- [#21](https://github.com/client-compose/client-compose/pull/21) [`5f172ba`](https://github.com/client-compose/client-compose/commit/5f172ba2bf48a2fbd61d3c260f1f590fd4390bf8) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - The Swift target generates actions: an `enum FollowUserV1: ActionDescriptor` holding `Input`,
  `Result` and a `DeclaredError` enum with a case per declared error. Generated Swift structs are now
  `Codable` with a memberwise `init`, so apps and tests can build them, also when `access` is `public`.

## 0.3.0

### Minor Changes

- [`8bd6c78`](https://github.com/client-compose/client-compose/commit/8bd6c78c377b4f5dd048d784145475adfcdb2b5d) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Action manifests (spec §5): set `actions` in the config to generate input, result and declared-error types for Go and TypeScript, and `compat` checks action changes too. `manifests` is now optional, for configs that only generate actions.

## 0.2.0

### Minor Changes

- [`d2788c6`](https://github.com/client-compose/client-compose/commit/d2788c64d636d362793dc7a0582b673d3761c4dc) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Add `compat`, which reports island manifest changes that break apps without a version bump
  (against a git ref or a directory), plus `--help` and `--version`. Standalone executables for
  Linux, macOS and Windows are now attached to each codegen GitHub release, so codegen no longer
  needs Node.

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).
