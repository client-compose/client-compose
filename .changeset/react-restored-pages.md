---
"@client-compose/react": minor
---

A page a router brings back from its cache (going back) catches up with the actions taken since it was shown. Its Client Component islands apply the changes and updates they missed, and `onStale` is called when one of them, or an island that's a Server Component, missed something only the server can show.
