---
"go-composer": minor
---

Screens and actions say when (spec §4, §5.3): a screen's `at` is when the composer started answering it, and an action's effects' `at` when it finished, in milliseconds since the Unix epoch. Clients compare them to catch a screen read before an action up with it.
