# @client-compose/composer

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
