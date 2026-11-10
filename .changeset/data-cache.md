---
"@client-compose/composer": minor
"go-composer": minor
---

Caching moves from islands to data (CMP-18). How long something can be cached is a property of the
data, not of the islands that show it, so each kind of data is declared once (`cc.NewData` in Go,
`defineData` in TypeScript) with how to fetch many by key, and how it may be cached: `CacheFor` /
`cacheMs`, `Tags` / `tags`, and `PerViewer` / `perViewer`, keyed by the composer's new `Viewer` /
`viewer`. Loads batch within a request as batch loaders' do, and are kept across requests in the
composer's `Cache`.

Breaking:
- Islands can't be cached any more: `Island.CacheFor` and `CacheKey` (Go) and `island(…, { cache })`
  (TypeScript) are gone. Islands always resolve; what they load is cached as its data says.
- `Cache.Get` / `get` is now `GetMany` / `getMany`, so a batch of keys is one round trip.
- Actions name data that changed beyond their entities in `Effects.Stale` / `stale` (tags); entity
  changes clear `EntityTag` / `entityTag` tags as before. Updating an island or invalidating a
  screen no longer clears anything from the cache.

Also: actions read fresh data (their loads skip the cache), islands an action updates are resolved
after its changes are cleared, concurrent misses share one fetch, and the test kits' `CheckEffects`
/ `checkEffects` fail when an action leaves the cache serving data a fresh request (`cc.Fresh`, or
`{ fresh: true }`) wouldn't.
