---
"@client-compose/codegen": patch
---

Internal: the Go and TypeScript targets now only render; one shared walk (`emit.ts`) decides what's generated and in what order. Generated output is unchanged.
