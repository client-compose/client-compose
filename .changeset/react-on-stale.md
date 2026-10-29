---
"@client-compose/react": minor
---

`onStale(effects)` replaces `onChanges`: it's called when what Server Components rendered is out of date after an action, and only the server can render it again: its screen was invalidated, or a change touched an island the browser can't change. An invalidation of any other screen no longer needs a refresh, so `onInvalidate` is no longer the place for `router.refresh()`.
