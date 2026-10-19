# @client-compose/conformance

The shared conformance suites for [Client Compose](https://github.com/client-compose/client-compose)
implementations, and a runner for them. Use it to prove a composer or client in any language
follows the protocol.

Node 20+

## Composer conformance (any language, over HTTP)

Build a test-only server for your composer that registers the `__conformance` screen
([spec §8.1](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md#81-composer-conformance-over-http)),
start it, then:

```sh
npx @client-compose/conformance composer http://localhost:4100
```

It exits non-zero if any case fails, so it drops straight into CI.

## Client conformance (fixtures)

Client implementations load the fixtures into their own unit tests
([spec §8.2](https://github.com/client-compose/client-compose/blob/main/spec/PROTOCOL.md#82-client-conformance-fixtures)).
From JavaScript:

```ts
import { clientCases, composerCases, runComposerCase } from "@client-compose/conformance";

for (const c of clientCases()) {
  // register c.registered, decode c.response, plan it, compare with c.expectRendered / c.expectSkipped
}
```

Other languages can read the same JSON from `node_modules/@client-compose/conformance/dist/cases/`,
or from the repository's
[`conformance/`](https://github.com/client-compose/client-compose/tree/main/conformance) folder.
