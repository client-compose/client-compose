---
"@client-compose/composer": minor
"go-composer": minor
---

The island cache stays up to date as actions change things. Each entry is filed under tags, the
island and the entities it holds, and an action's effects invalidate what they name before its
updates resolve. The `Cache` adapter gains tags on `set` and an `invalidate(tags)` method (a
breaking change to implementations). Requests for an entry being resolved wait for it.
