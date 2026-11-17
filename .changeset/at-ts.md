---
"@client-compose/protocol": minor
"@client-compose/composer": minor
"@client-compose/react": minor
"@client-compose/conformance": minor
---

A screen read before an action finished, and shown after it, catches up with the action (spec §5.3). Composers send `at` on a screen (when they started answering it) and on an action's effects (when it finished). `@client-compose/react` keeps the actions it performed with their `at`, and a screen it shows for the first time, from `useScreen` or rendered by a Server Component, gets the changes and updates of every action that finished after its `at`, or is loaded (or rendered by the server) again when only that can show one. Navigating while an action is in flight no longer shows what it changed as it was.
