---
"@client-compose/codegen": minor
---

Add `compat`, which reports island manifest changes that break apps without a version bump
(against a git ref or a directory), plus `--help` and `--version`. Standalone executables for
Linux, macOS and Windows are now attached to each codegen GitHub release, so codegen no longer
needs Node.
