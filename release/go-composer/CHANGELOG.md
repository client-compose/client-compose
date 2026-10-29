# go-composer

## 0.13.0

### Minor Changes

- [#65](https://github.com/client-compose/client-compose/pull/65) [`18f247d`](https://github.com/client-compose/client-compose/commit/18f247d6c4f0bd170b23cfa254cd5930a27ce4e4) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - `cctest.Composer(c)` names the composer inside a handler that wraps it, and `CheckEffects` takes request options (such as a session header) for the screen it checks.

## 0.12.1

### Patch Changes

- [#63](https://github.com/client-compose/client-compose/pull/63) [`3e242e6`](https://github.com/client-compose/client-compose/commit/3e242e635746aca7c0925b57806226f7ad2b5acb) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Updated examples in the documentation.

## 0.12.0

### Minor Changes

- [#55](https://github.com/client-compose/client-compose/pull/55) Entity changes and island updates (spec §5.3): `cc.Set` and `cc.Delete` for an action's changes, `Effects.Update` for its island updates, resolved in a fresh request scope, and `cctest.CheckEffects` to check them against the screen composed again.

### Patch Changes

- [#53](https://github.com/client-compose/client-compose/pull/53) An island update carries its screen's params as an object, even when there are none.
