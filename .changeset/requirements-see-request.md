---
"@client-compose/composer": minor
---

**Breaking:** requirements receive the request as well as the context: `(ctx, { screen, params, client })`.
A screen can now require that what its params refer to exists and that the viewer may see it, and
answer 404 or 403 without a layout function. `reportErrors` returns a plain plugin, so it fits any
composer without type arguments.
