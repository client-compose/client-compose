---
"@client-compose/composer": minor
---

Screen strings outside a request: `stringsFor(config, locale).strings(InviteScreenStrings)` reads a
screen's strings, typed by their generated descriptor, for words a composer sends outside any
request, such as an email or a notification.
