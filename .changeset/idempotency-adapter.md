---
"@client-compose/composer": minor
---

An optional idempotency adapter (CMP-19). Give the composer `idempotency: { store, scope }` (your own
`begin`/`finish`/`release`, over Redis or anything else) and it honours action idempotency keys: a
retry returns the first outcome instead of running again, a duplicate in flight waits for it, and
failures release the key. Without it, keys pass through to actions as before.
`memoryIdempotencyStore()` in `@client-compose/composer/testing` is an in-memory one for tests.
