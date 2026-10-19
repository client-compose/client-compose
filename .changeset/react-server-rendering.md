---
"@client-compose/react": minor
---

Server rendering and React Server Components support:

- New `@client-compose/react/server` entry with an async Server Component `ComposedScreen`.
- The main entry is now safe to import from Server Components: hooks and components live in a
  `"use client"` module, and the registry and new `loadScreen` work anywhere.
- `loadScreen` plus a new `initialResponse` option on `useScreen` and `<ComposedScreen>`: render
  server-fetched islands into the HTML and hydrate without refetching. A new `initialResponse`
  from a navigation or refresh is used without a browser request.
- Each island now also gets its own `<Suspense>` boundary, so an island that throws during server
  rendering renders as nothing instead of replacing the whole screen with its fallback.
- Re-exports the `IslandDescriptor` and `ScreenResponse` types, so React apps (and codegen output
  with `"protocolImport": "@client-compose/react"`) only need this package.
