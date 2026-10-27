# @client-compose/codegen

## 0.8.0

### Minor Changes

- [#47](https://github.com/client-compose/client-compose/pull/47) [`fb57f76`](https://github.com/client-compose/client-compose/commit/fb57f7604155f07b8257888fbf8832d79805f9d8) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Actions read screen strings (spec §4.7), for words their results carry: `ac.strings(descriptor)` in
  TypeScript, and in Go `call.ScreenStrings(screen)`, or the generated `XScreenStringsFor(call)`, which
  now takes a Request or a Call (`cc.ScreenStringsSource`).

## 0.7.0

### Minor Changes

- [#43](https://github.com/client-compose/client-compose/pull/43) [`70ff47c`](https://github.com/client-compose/client-compose/commit/70ff47c0a7b511db17586f34819a2ab472350792) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Screen strings (spec §4.7): a screen's own words, such as its meta's title, which its composer uses
  itself. Declared by screen id in a screen strings manifest (`screenStrings` in the codegen config),
  kept in the catalog under `screens`, and never sent to clients as such.
  
  - Protocol: `ScreenStringsDescriptor`. `formatString`, `pluralCategory` and `buildStrings` move
    here from the client, which still exports them.
  - Composer: `lc.strings(CreatorScreenStrings)` in layouts, conditions, resolvers and meta. Meta
    fields that are empty are left out, as the Go composer does.
  - Codegen: `XScreenStrings` types and descriptors for TypeScript, and for Go
    `XScreenStringsFor(r)` with a method per string; the catalog check covers `screens`.
  - Conformance: a case for a screen's meta from its own strings.

## 0.6.0

### Minor Changes

- [#41](https://github.com/client-compose/client-compose/pull/41) [`669292e`](https://github.com/client-compose/client-compose/commit/669292ebbd0bfa3b647b7b91ad6e9ff688ebc7fc) Thanks [@LewisYearsley](https://github.com/LewisYearsley)! - Strings (spec §4.7). Every word an app shows comes from the composer, in the client's language, so
  copy changes, and languages are added, without an app release.
  
  - Protocol: island manifests declare `strings` (keys, their `params`, and `counted`), and an app
    strings manifest the words outside any island. An island entry carries its `strings`; the head,
    and an island response with strings, carry `locale` and `plurals` (CLDR's plural rules, for
    whole numbers). `POST /strings` answers the app strings. Templates fill in `{name}`; counted
    strings have variants keyed `#<n>`, `#<category>` or `#*`.
  - Composer: `strings: { catalog: loadCatalog("strings"), defaultLocale }`, one JSON file per
    language. The nearest language is chosen (`pl-PL`, then `pl`, then the default), string by
    string. `/strings` runs without `context`. `testComposer` gains `strings()`.
  - Adapters serve `/strings` (Fastify registers the route).
  - Client: an island registered by a descriptor with strings gets its props with `t`;
    `fetchStrings`, `appStrings`, `formatString`, `pluralCategory`; `proxy.loadStrings`. The fake
    composer answers `strings`, and `island(…, { strings })`, `stringsResponse` and the screen
    builders' language build responses.
  - React: `registerComponent` types the component's `t`; a Client Component rendered by a Server
    Component builds its `t` in the browser. `AppStringsProvider` (with a `cache`, `loading` and
    `failed`) and `useAppStrings`; `viaProxy({ loadStrings })`; config `loadStrings`.
  - Codegen: typed strings for TypeScript, Swift and Kotlin; `appStrings`, `catalog` and
    `defaultLocale` in the config; compatibility rules for strings; `client-compose-codegen strings`
    checks a catalog against the manifests.
  - Conformance: plural cases from CLDR for 224 languages and template cases for clients;
    strings cases and a catalog (`conformanceCatalogDir()`) for composers.

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
