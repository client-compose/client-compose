---
"@client-compose/protocol": minor
"@client-compose/composer": minor
"@client-compose/client": minor
"@client-compose/react": minor
"@client-compose/conformance": minor
---

Island requests (spec §4.5): an island's next page, and refreshing one island. An island entry may
carry `next`, an opaque cursor; `POST /screens/{screen}/islands/{key}` resolves that one island
again, for the page a cursor asks for or from its first page.

- Protocol: `IslandRequest`, `IslandResponse`, and `next` on island entries.
- Composer: `pagedIsland`, `rc.cursor`, `InvalidCursorError`, `composeIsland`, and island requests in
  `testComposer` (`island`, `nextPage`, `next`).
- Client: `buildIslandRequest`, `fetchIsland`, `proxy.loadIsland`, and island handlers in the fake
  composer (`islands`, `islandResponse`, `island(…, next)`).
- React: `usePages`, and `viaProxy`'s `loadIsland`.
- Conformance: island cases (`islandCases`, `runIslandCase`), paged mocks, and a client fixture for
  `next`.
