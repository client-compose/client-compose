# go-composer

## 0.12.1

### Patch Changes

- [#63](https://github.com/client-compose/client-compose/pull/63) [`3e242e6`](https://github.com/client-compose/client-compose/commit/3e242e635746aca7c0925b57806226f7ad2b5acb) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Updated examples in the documentation.

## 0.12.0

### Minor Changes

- [#55](https://github.com/client-compose/client-compose/pull/55) Entity changes and island updates (spec §5.3): `cc.Set` and `cc.Delete` for an action's changes, `Effects.Update` for its island updates, resolved in a fresh request scope, and `cctest.CheckEffects` to check them against the screen composed again.

### Patch Changes

- [#53](https://github.com/client-compose/client-compose/pull/53) An island update carries its screen's params as an object, even when there are none.
