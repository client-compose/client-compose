---
"@client-compose/client": minor
"@client-compose/react": minor
"@client-compose/conformance": minor
---

Client conformance fixtures for actions and effects (`clientActionCases()`), and the TypeScript
client now passes them:

- An error code the action doesn't declare, such as one added after the app was built, is a
  failure (spec §5.1): `callAction` throws `ActionFetchError` with that code, and `useAction` ends
  with `{ status: "failed" }`. It used to be returned as if it were a declared error.
- A body that isn't JSON, or isn't an outcome, is an `ActionFetchError` rather than a `SyntaxError`.
- New `checkActionResponse(action, response)`, for transports of your own.
