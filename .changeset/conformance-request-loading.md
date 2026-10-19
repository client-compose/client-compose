---
"@client-compose/conformance": minor
---

New composer cases for request-scoped loading (spec §9): islands that load the same key share one
call, and an island timing out doesn't cancel a load other islands share. Conformance servers need
to support the mock `load`, `loadDelayMs` and `startDelayMs` placement fields.
