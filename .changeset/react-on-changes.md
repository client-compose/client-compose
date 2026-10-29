---
"@client-compose/react": minor
---

`onChanges(effects)` in the config hears an action's entity changes and island updates, for screens
the browser can't change itself, such as Server Components (`router.refresh()`). The entity types
(`EntityDescriptor`, `EntityPath`, `EntityChange`) are re-exported, for codegen output that imports
the protocol from `@client-compose/react`.
