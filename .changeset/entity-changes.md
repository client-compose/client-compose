---
"@client-compose/protocol": minor
"@client-compose/client": minor
"@client-compose/react": minor
"@client-compose/composer": minor
"@client-compose/codegen": minor
"@client-compose/conformance": minor
---

Entity changes and island updates (spec §2.1, §5.3), so actions don't reload whole screens.

- **Codegen** reads entity manifests (`"entities"`), checks the objects islands mark with `entity`,
  and generates entity types and, on island descriptors, where they hold entities.
- **Composers:** an action returns `changes` (`changed(TodoEntity, id, { … })`,
  `deleted(TodoEntity, id)`) and names islands to `update`, which the composer resolves again, in
  a fresh scope, at the client's versions, invalidating the screen when it can't. The test kit's
  `checkEffects` compares an action's effects with a fresh resolve.
- **Clients** send their `islands` with every action request (now required), and
  `applyChanges` applies entity changes to an island's props. The React binding applies them next.
