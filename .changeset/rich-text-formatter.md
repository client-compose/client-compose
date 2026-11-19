---
"@client-compose/react": minor
---

`richText` takes the string itself and its params, with nodes for any of them:
`richText(t.newHere, { link: <a href="/sign-up">{t.signUp}</a> })`. Params no longer need filling
with their own placeholders first, and are type-checked against the string's. Breaking: pass the
string's function, not a formatted string.
