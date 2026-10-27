---
"@client-compose/protocol": minor
"@client-compose/composer": minor
"@client-compose/client": minor
"@client-compose/codegen": minor
"@client-compose/conformance": minor
---

Screen strings (spec §4.7): a screen's own words, such as its meta's title, which its composer uses
itself. Declared by screen id in a screen strings manifest (`screenStrings` in the codegen config),
kept in the catalog under `screens`, and never sent to clients as such.

- Protocol: `ScreenStringsDescriptor`. `formatString`, `pluralCategory` and `buildStrings` move
  here from the client, which still exports them.
- Composer: `lc.strings(CreatorScreenStrings)` in layouts, conditions, resolvers and meta. Meta
  fields that are empty are left out, as the Go composer does.
- Codegen: `XScreenStrings` types and descriptors for TypeScript, and for Go
  `XScreenStringsFor(r)` with a method per string; the catalog check covers `screens`.
- Conformance: a case for a screen's meta from its own strings.
