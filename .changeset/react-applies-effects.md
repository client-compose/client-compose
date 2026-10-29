---
"@client-compose/react": minor
"@client-compose/client": minor
---

React applies an action's entity changes and island updates (spec §5.3): to every screen on show,
cached screens, and every page a paged island holds, without fetching; a screen that can't take
them reloads. The registry knows where each island holds entities, from its descriptor.
