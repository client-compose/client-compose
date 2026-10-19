# @client-compose/conformance

## 0.2.0

### Minor Changes

- [`55613c9`](https://github.com/client-compose/client-compose/commit/55613c91f661064f9856b1654c08c47a697a64f4) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - New composer cases for request-scoped loading (spec §9): islands that load the same key share one
  call, and an island timing out doesn't cancel a load other islands share. Conformance servers need
  to support the mock `load`, `loadDelayMs` and `startDelayMs` placement fields.

## 0.1.0

### Minor Changes

- [`2bd896f`](https://github.com/client-compose/client-compose/commit/2bd896fee62538ca2dcb8b84b3ef452caf5e47f6) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Initial release of the Client Compose TypeScript packages (protocol v0).
