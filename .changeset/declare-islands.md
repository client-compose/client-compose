---
"@client-compose/client": minor
"@client-compose/react": patch
---

`registry.declare(...descriptors)` names islands the app renders somewhere else, such as Server Components rendered on the server: actions say the app can draw them, and changes to their entities apply to them, though the registry can't render them.
