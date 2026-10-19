---
"@client-compose/react": minor
---

The Server Component `ComposedScreen` accepts a `response` (or promise of one) already loaded with
`loadScreen`, and renders it without fetching. Lets a page share one request between
`generateMetadata` and the screen (with React's `cache()`).
