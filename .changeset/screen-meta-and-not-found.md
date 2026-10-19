---
"@client-compose/protocol": minor
"@client-compose/client": minor
"@client-compose/composer": minor
"@client-compose/conformance": minor
"@client-compose/react": patch
---

Screen `meta` and `not_found` (spec §4, §4.3):

- Responses can carry optional `meta` (`title`, `description`, `image`) describing the screen as a
  whole, from a screen's new `meta` function, which runs alongside the islands and shares their loads.
- A layout throwing `NotFoundError` (or a batch loader's missing key) responds 404 `not_found`,
  distinct from `unknown_screen`. `ScreenFetchError` now exposes the protocol error `code`.
- New `onLayoutError` and `onMetaError` composer options; two new conformance cases.
- `@client-compose/react` re-exports `ScreenMeta`.
