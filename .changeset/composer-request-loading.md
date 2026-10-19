---
"@client-compose/composer": minor
---

Request-scoped data loading. `rc.load(key, fn)` (on resolver and layout contexts) runs `fn` once per
key per screen request and shares the result with every island and the layout; the work runs under
the request's signal, so an island timing out never cancels work other islands are waiting on, and
whatever is still running is cancelled once the response is ready. `defineBatchLoader` combines and
de-duplicates keys requested by different islands into one call. Also exports `LayoutContext`.
