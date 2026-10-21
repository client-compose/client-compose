---
"@client-compose/client": minor
"@client-compose/react": minor
---

Send screens and actions through your own server. `@client-compose/client/proxy`'s `createComposerProxy` is the server half (e.g. inside Next.js Server Actions): it checks what the browser sent, sets the client context and headers (such as a session from an httpOnly cookie), lets you see and change each action's response, and returns failures as data. `viaProxy` in `@client-compose/react` is the browser half: it turns those functions into the config's `fetch` and `performAction`.

`installFakeGateway(handlers)` in `@client-compose/client/testing` (and `@client-compose/react/testing`) installs the fake composer as the global `fetch`, for code that fetches by itself; `restore()` puts the original back.
