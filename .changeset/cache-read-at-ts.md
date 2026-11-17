---
"@client-compose/composer": minor
---

**Breaking:** `Cache.set` takes `readAt`, when the value was read (milliseconds since the Unix epoch), and stores nothing filed under a tag invalidated since: a request that read data before an action changed it no longer stores it after the action cleared it, bringing the change back for the entry's whole ttl. `invalidate` remembers when it cleared each tag, for at least as long as a request takes. `memoryCache()` does both; the `Cache` docs show a Redis implementation.
