---
"@client-compose/client": minor
"@client-compose/react": minor
---

Testing helpers and action error helpers.

- `@client-compose/client/testing`: `createFakeGateway`, a fake composer that answers screen and action requests from handlers and records them, and response builders typed by generated descriptors (`island`, `islandError`, `screen`, `screenError`, `actionOk`, `actionError`, `actionFailure`).
- `@client-compose/react/testing`: everything above, plus `createTestConfig`, a provider config for tests that uses the fake composer and records `navigate` and `invalidate` effects.
- `@client-compose/react`: `declaredError(result)` and `isUnexpected(result, handled)` for showing how an action call ended.
