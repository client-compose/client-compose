---
"go-composer": minor
---

**Breaking:** `Cache.Set` takes `readAt`, when the value was read, and stores nothing filed under a tag invalidated since: a request that read data before an action changed it no longer stores it after the action cleared it, bringing the change back for the entry's whole ttl. `Cache.Invalidate` remembers when it cleared each tag, for at least as long as a request takes. `cctest.MemoryCache` does both; the `Cache` docs show a Redis implementation.
