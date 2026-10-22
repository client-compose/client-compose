---
"@client-compose/codegen": minor
---

The Kotlin target generates actions: an `object FollowUserV1 : ActionDescriptor<…>` holding `Input`,
`Result` and a sealed `Error` with a subclass per declared error.
