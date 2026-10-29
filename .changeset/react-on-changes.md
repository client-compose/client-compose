---
"@client-compose/react": minor
---

Server Components take an action's entity changes and island updates in the browser. A Client
Component island rendered by `<ComposedScreen>` from `@client-compose/react/server` applies them
itself, as `useScreen` does, until the server renders it again. A new `onChanges(effects)` in the
config hears the ones only the server can show: they touch an island that's a Server Component, or
one a Client Component can't take. Re-render then, e.g. with `router.refresh()`. The browser's
config needs the app's registry for this: it says where islands hold entities, and which islands
actions may update. The entity types (`EntityDescriptor`, `EntityPath`, `EntityChange`) are
re-exported, for codegen output that imports the protocol from `@client-compose/react`.
