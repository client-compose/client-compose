# Client Compose Protocol — v0 (draft)

Client Compose is a small protocol for **server-composed screens made of client-owned islands**.

- An **island** is a self-contained piece of UI that a client knows how to render
  (e.g. `profile-header`). The client owns its look, layout and local interactivity.
- An island declares **props**: the data it needs, described by a JSON Schema.
- A **screen** is a flat, ordered list of islands.
- A **composer** (the middle layer) decides which islands make up a screen and resolves
  their props by calling backend services.

The protocol deliberately does **not** describe layout trees, styling, or generic UI
primitives. If you need those, the island is too small; make a new island.

---

## 1. Design principles

1. **Flat, not a tree.** A screen is `Island[]`. No nesting, no containers, no layout
   instructions. Order is the only layout hint.
2. **The client is the source of truth for what it can render.** Every request carries
   the client's island capabilities. The composer must never send an island/version
   the client did not declare.
3. **Props are a contract, versioned per island.** Breaking a prop shape means a new
   island version, never an in-place change.
4. **Failure is per island.** One failing backend must not blank a whole screen.
5. **Transport- and stack-agnostic.** The canonical encoding is JSON over HTTP, but
   nothing in the model depends on it.

---

## 2. Island manifests

Each island type is described by a manifest (see `schema/island-manifest.schema.json`).
Manifests live somewhere every team can see (e.g. a shared repo; see
`examples/profile/islands/`) and are the input to codegen for every platform.

```json
{
  "type": "profile-header",
  "version": 2,
  "description": "User avatar, display name and optional badge.",
  "props": {
    "type": "object",
    "required": ["displayName", "avatarUrl"],
    "properties": {
      "displayName": { "type": "string" },
      "avatarUrl": { "type": "string", "format": "uri" },
      "badge": { "type": "string" }
    }
  }
}
```

`props` uses the small JSON Schema subset that `codegen/` supports (see `codegen/README.md`),
so that every language maps it the same way.

Rules:

- `type` is a stable kebab-case identifier. It never changes meaning.
- `version` is a positive integer. Within a version, a change MUST keep old clients decoding
  new payloads and new clients decoding old payloads: optional props MAY be added or removed;
  anything else (adding or removing required props, changing whether a prop is required,
  retyping, changing a format, adding or removing an enum value) is a new version. The
  `codegen compat` command checks this.
- A client MAY support several versions of one island at once.

---

## 3. Request

`POST {base}/screens/{screen}` with body (`schema/screen-request.schema.json`):

```json
{
  "protocol": 0,
  "screen": "profile",
  "params": { "userId": "u_123" },
  "client": {
    "platform": "ios",
    "appVersion": "4.2.0",
    "locale": "en-GB"
  },
  "islands": {
    "profile-header": [1, 2],
    "follow-button": [1],
    "post-grid": [1]
  }
}
```

| Field      | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `protocol` | Protocol major version the client speaks.                               |
| `screen`   | Screen identifier. Also in the path for routing/caching.                |
| `params`   | Screen inputs (route params, ids). String values only.                  |
| `client`   | Free-form-ish context for targeting. `platform` and `appVersion` required. |
| `islands`  | **Capabilities**: island type → supported versions.                     |

Clients SHOULD send identity/auth via transport headers, not the body.

> Capabilities can be large. A composer MAY accept a `capabilitiesHash` instead, once
> it has seen the full set for that hash (reserved for v1; not specified yet).

---

## 4. Response

```json
{
  "protocol": 0,
  "screen": "profile",
  "islands": [
    {
      "key": "header",
      "type": "profile-header",
      "version": 2,
      "status": "ok",
      "props": { "displayName": "Ada", "avatarUrl": "https://…/ada.png" }
    },
    {
      "key": "posts",
      "type": "post-grid",
      "version": 1,
      "status": "error",
      "error": { "code": "upstream_timeout", "retryable": true }
    }
  ],
  "cache": { "maxAge": 30 }
}
```

### 4.1 Island entries

| Field     | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `key`     | Unique within the screen. Stable across requests (use for diffing/analytics). |
| `type`    | Island type. MUST be one the client declared.                              |
| `version` | Island version. MUST be one the client declared for that type.            |
| `status`  | `ok` or `error`.                                                           |
| `props`   | Present iff `status` is `ok`. MUST validate against the manifest.         |
| `error`   | Present iff `status` is `error`. `{ code, retryable?, message? }`.        |

### 4.2 Version negotiation (composer side)

For each island the composer wants to place:

1. Intersect the versions the composer can resolve with the versions the client declared.
2. If the intersection is non-empty, use the **highest** version.
3. Otherwise, the island is **omitted** from the response. (The composer MAY substitute
   a different island it knows the client supports; that is a screen-definition concern.)

### 4.3 Failure semantics

- A placed island whose resolution fails is returned with `status: "error"`. The client
  decides how to present it (hide, placeholder, retry). Default: hide.
- A screen definition MAY mark an island `required`. If a required island cannot be
  placed or fails, the whole screen fails with a non-2xx response and body
  `{ "protocol": 0, "error": { "code": "...", "message": "..." } }`.
- Unknown fields in any payload MUST be ignored by both sides (forward compatibility).

### 4.4 Client rendering rules

- Render islands in array order.
- If the client receives an island/version it didn't declare (a composer bug), it MUST
  skip it rather than crash.
- If an island has a `status` the client doesn't recognise (e.g. a future `pending`), it
  MUST skip it.
- Typed clients (Swift, Kotlin, …) that fail to decode an island's props MUST skip that
  island rather than fail the screen, and SHOULD report it.
- Props SHOULD be validated client-side in debug builds only.

---

## 5. Interactivity & actions

Out of scope for v0 by design: interactivity is the island's own business. An island
that needs to navigate or mutate does so with its own client code, using data passed in
props (e.g. `profileUrl`, `userId`).

If a pattern emerges (e.g. most islands carry a `deeplink` prop), we will standardise a
small `Action` value type in a later version — **not** a scripting language.

---

## 6. Explicit non-goals

- Layout primitives (rows, columns, stacks, spacing).
- Styling/theming.
- Nested islands or slots.
- Client-side logic shipped from the server.
- Replacing your API layer. Islands that need fine-grained, interactive data fetching
  should still call APIs directly.

---

## 7. Open questions (v1 candidates)

- **Deferred islands / streaming**: return fast islands first, stream slow ones
  (NDJSON or SSE), marked `status: "pending"`.
- **Island refresh**: re-resolve a single island by `key` without the whole screen.
- **Capability hashing** to shrink requests.
- **Per-island cache hints** vs screen-level `cache`.
- **Analytics/experiment metadata** on each island (`experiment`, `variant`).

---

## 8. Conformance

Implementations prove compliance with the shared suites in `conformance/`. Neither suite
needs knowledge of the implementation's language.

### 8.1 Composer conformance (over HTTP)

A composer implementation ships a **conformance server**: a test-only binary that
serves the normal `POST /screens/{screen}` endpoint with exactly one screen registered,
`__conformance`. That screen reads `params.placements`, a JSON-encoded array of:

```json
{ "key": "posts", "type": "post-grid", "versions": [1, 2], "outcome": "ok",
  "required": false, "timeoutMs": 50 }
```

and places one island per entry, with one resolvable version per entry in `versions`.
The mock resolver for version `n`:

| `outcome` | Behaviour                                              |
| --------- | ------------------------------------------------------ |
| `ok`      | resolves to props `{ "v": n }`                         |
| `error`   | fails                                                  |
| `timeout` | never resolves on its own (it MUST honour cancellation) |

`required` and `timeoutMs` map to the composer's own placement options. If
`params.placements` is not valid JSON, the screen's layout fails. The runner then
sends each case in `conformance/composer/cases.json` and checks status codes and bodies.

If a mock has `load` (a key), its resolver first waits `startDelayMs`, then calls the composer's
request-scoped load (§9) with that key and work that counts how often it runs, takes `loadDelayMs`,
and fails if its cancellation signal fires. It then resolves to `{ "v": n, "calls": <runs of that
key's work so far in this request> }`.

The `__conformance` screen MUST NOT be registered in production builds.

Error codes the suite checks, for composers to use consistently:

| Situation                                  | Status | `error.code`                  |
| ------------------------------------------ | ------ | ----------------------------- |
| Body isn't valid JSON or misses fields     | 400    | `bad_request`                 |
| `protocol` not supported                   | 400    | `unsupported_protocol`        |
| Body `screen` differs from path            | 400    | `screen_mismatch`             |
| Unknown screen                             | 404    | `unknown_screen`              |
| Screen layout itself failed                | 500    | `layout_failed`               |
| Required island has no common version      | 502    | `required_island_unsupported` |
| Required island failed                     | 502    | `required_island_failed`      |
| Island failed (in-body, status 200)        | —      | `resolve_failed`              |
| Island timed out (in-body, status 200)     | —      | `timeout` (`retryable: true`) |

### 8.2 Client conformance (fixtures)

`conformance/client/cases.json` holds registry setups, raw response JSON and the expected
render output. Each client implementation runs them in its own unit tests, using a test
renderer that outputs `"{type}@{version}:{props.v}"` and, when a case sets
`renderErrors`, an error fallback that outputs `"error:{key}:{error.code}"`.

---

## 9. Request-scoped loading (composer implementations)

Several islands on one screen often need the same data (the header and the follow button both
need the profile's user). Composer cores MUST provide a request-scoped load:

- `load(key, work)` runs `work` at most once per key per screen request, and every caller in that
  request (other islands and the layout) receives the same result or error.
- `work` runs under the **request's** lifetime, not the calling island's: an island timing out MUST
  NOT cancel work that other islands are waiting on. Each caller still stops waiting at its own
  timeout.
- Work still running when the response is ready is cancelled.
- Results are never shared between requests.

Cores SHOULD also offer a batch loader that combines keys requested by different islands in the same
request into one call. Caching across requests is out of scope here: it belongs in the services a
composer calls, where cache keys can account for who is asking.

The conformance suite checks the MUST rules (§8.1).
