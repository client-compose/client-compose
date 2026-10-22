---
"@client-compose/express": minor
"@client-compose/fastify": minor
---

New adapters: `composerHandler(composer)` for Express 5 and `composerPlugin(composer)` for Fastify 5.
Each passes its own request type to the composer's `context`, and both pass the conformance suite.
