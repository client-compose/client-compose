---
"@client-compose/codegen": minor
---

The Swift target generates actions: an `enum FollowUserV1: ActionDescriptor` holding `Input`,
`Result` and a `DeclaredError` enum with a case per declared error. Generated Swift structs are now
`Codable` with a memberwise `init`, so apps and tests can build them, also when `access` is `public`.
