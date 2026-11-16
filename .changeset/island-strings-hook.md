---
"@client-compose/react": minor
"@client-compose/client": minor
---

`useIslandStrings(descriptor)`: a component inside an island gets the island's strings, typed as
its `t`. A Client Component inside a Server Component island, which can't be passed `t` (it's made
of functions), builds it in the browser from the strings the registry sends with the island. In
tests, `inIsland(descriptor, node, { strings, plurals })` renders a component inside an island, and
`catalogStrings` gives an island's `strings(descriptor)` and the language's `plurals` for it.
