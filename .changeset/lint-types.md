---
"@client-compose/client": patch
"@client-compose/react": patch
---

Tighter types: `IslandRenderer` and island entries default their props to `unknown` instead of
`any`, and `registerComponent` takes props that are objects (as generated props types are).
