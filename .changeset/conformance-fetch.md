---
"@client-compose/conformance": minor
---

`runComposerCase`, `runActionCase` and `runComposerConformance` take an optional `fetch`, so the suite
can run in-process against a fetch-standard handler such as `composer.fetch`.
