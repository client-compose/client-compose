---
"@client-compose/client": minor
"@client-compose/react": minor
---

Strings, easier to use. `IslandProps<typeof RecipeListV1>` types an island's component (its props,
with `t` when it declares strings). `preferredLocale` picks `client.locale` from a device's tags or an
Accept-Language header. React adds `richText`, to put links into a sentence, and `useLocale()`. For
React Server Components, `serverComposer` asks for a request's screens and app strings once, however
many components ask. For tests, `catalogStrings(catalog)` reads a catalog file as the composer would
send it.
