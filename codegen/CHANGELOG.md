# @client-compose/codegen

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
