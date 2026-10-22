---
"@client-compose/composer": minor
---

An optional cache adapter (CMP-18). Give the composer a `cache` (your own `get`/`set`, over Redis or
anything else) and islands opting in with `island(Descriptor, resolve, { cache: { ttlMs, key } })`
are served from it while fresh. Without a cache, nothing changes. Failures are never cached, and a
cache that errors is reported (`kind: "cache"`) and bypassed. `memoryCache()` in
`@client-compose/composer/testing` is an in-memory one for tests.
