---
"@client-compose/composer": minor
---

Layout, resolver and action contexts have `locale`: the language the composer answers in (the catalog's nearest to the client's locale, as the stream's head reports), for formatting and words kept outside the catalog. Without a catalog, the client's own locale.
