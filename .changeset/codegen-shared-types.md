---
"@client-compose/codegen": minor
---

Shared types (spec §2.2): define an object or a string enum once, in a `types` directory, and use it from any island, action, entity or other shared type with `{ "$ref": "<name>" }`. Each is generated once, under its own name, for Go and TypeScript. References are written out wherever schemas are embedded or compared (action input schemas, entity checks), and `compat` judges a change to a shared type in every island and action that uses it.
