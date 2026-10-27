---
"@client-compose/composer": minor
"@client-compose/codegen": minor
---

Actions read screen strings (spec §4.7), for words their results carry: `ac.strings(descriptor)` in
TypeScript, and in Go `call.ScreenStrings(screen)`, or the generated `XScreenStringsFor(call)`, which
now takes a Request or a Call (`cc.ScreenStringsSource`).
