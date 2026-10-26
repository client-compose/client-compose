---
"@client-compose/client": patch
---

`fetchScreen`, `fetchAction`, `fetchIsland` and `createComposerProxy` keep headers given as a
`Headers` object or as pairs, instead of dropping them, and send `content-type: application/json`
unless the caller sets their own.
