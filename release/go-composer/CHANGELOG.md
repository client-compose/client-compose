# go-composer

## 0.12.0

### Minor Changes

- [#55](https://github.com/client-compose/client-compose/pull/55) Entity changes and island updates (spec §5.3): `cc.Set` and `cc.Delete` for an action's changes, `Effects.Update` for its island updates, resolved in a fresh request scope, and `cctest.CheckEffects` to check them against the screen composed again.

### Patch Changes

- [#53](https://github.com/client-compose/client-compose/pull/53) An island update carries its screen's params as an object, even when there are none.
