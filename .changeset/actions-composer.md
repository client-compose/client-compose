---
"@client-compose/composer": minor
---

Actions (spec §5): `defineAction`, `createActions` and `performHttp`. Input is validated against the action's manifest, declared errors are typed outcomes, and effects tell clients which screens changed. `UnauthenticatedError` and `ForbiddenError` respond 401 / 403 from layouts and actions. `conformanceActions()` for conformance servers.
