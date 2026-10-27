---
"@client-compose/protocol": minor
"@client-compose/composer": minor
"@client-compose/node-http": minor
"@client-compose/express": minor
"@client-compose/fastify": minor
"@client-compose/client": minor
"@client-compose/react": minor
"@client-compose/codegen": minor
"@client-compose/conformance": minor
---

Strings (spec §4.7). Every word an app shows comes from the composer, in the client's language, so
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
