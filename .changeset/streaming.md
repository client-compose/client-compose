---
"@client-compose/protocol": minor
"@client-compose/composer": minor
"@client-compose/node-http": minor
"@client-compose/express": minor
"@client-compose/fastify": minor
"@client-compose/client": minor
"@client-compose/react": minor
"@client-compose/conformance": minor
---

Screens stream (spec §4.6). A screen is answered as JSON lines (`application/jsonl`): a head, once
everything that could fail the screen is settled (requirements, layout and conditions, required
islands, meta), with islands not yet ready marked `pending`; then each of those as it's resolved;
then an end. Breaking: every screen response is a stream.

- Protocol: `PendingIsland`, `ScreenHead` and `ScreenStreamLine`.
- Composer: a successful `compose` result's body is a `ScreenStream` (`head`, and `islands` as they
  come); `collect` puts one together. `handle` answers with a `contentType` and a body that's a
  string or, for a screen, its lines as an async iterable. `testComposer` screens have a `head`.
- Adapters (node:http, Express, Fastify) send each line as it's ready. Fastify now registers the
  island request route too.
- Client: `openScreen` resolves with a screen's head and then its islands as they arrive;
  `fetchScreen` reads the whole stream; `collectScreen`, `withIsland`, `screenLines`. Placeholders:
  `registry.registerPlaceholder`, which `plan` shows for pending islands. The fake composer streams
  screens, and `streamedScreen` and `pending` let a test say when each island arrives.
- React: screens render as they stream, by default: `registerComponent(…, { placeholder })`,
  `progressive` in the config and per screen, `streaming` in `useScreen`, and a reload keeps what's
  shown until it's replaced. The Server Component `ComposedScreen` streams pending islands in, each
  in its own `<Suspense>` with its placeholder, and takes a `stream` from `streamScreen` (to share
  with `generateMetadata`). `viaProxy` answers screens as streams.
- Conformance: screen responses are checked as streams (`expect.pending`, `expect.resolved`); mocks
  take `startDelayMs`; client fixtures are streams, with cases for putting one together, islands
  that never arrive, and lines to ignore.
