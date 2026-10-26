# Client Compose Protocol — v0 (draft)

Client Compose is a small protocol for **server-composed screens made of client-owned islands**.

- An **island** is a self-contained piece of UI that a client knows how to render
  (e.g. `profile-header`). The client owns its look, layout and local interactivity.
- An island declares **props**: the data it needs, described by a JSON Schema.
- A **screen** is a flat, ordered list of islands.
- A **composer** (the middle layer) decides which islands make up a screen and resolves
  their props by calling backend services.
- An **action** is a typed call that changes something (§5). Its result can tell clients which
  screens to reload.

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

A screen is answered as a stream (§4.6), so a client can show its islands as each is ready. Put
together, the stream is the screen, in this shape (`schema/screen-response.schema.json`):

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
  "meta": { "title": "Ada Lovelace", "description": "Recipes by Ada" },
  "cache": { "maxAge": 30 }
}
```

`meta` is optional. It describes the screen as a whole, for things no single island owns: a web
page's `<title>`, description and sharing image, or a native navigation header's title.

| Field         | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| `title`       | Short screen title.                                       |
| `description` | One or two sentences describing the screen's content.     |
| `image`       | Absolute URL of an image representing the screen.         |

All three are optional strings. Clients use what applies to them and ignore the rest.

### 4.1 Island entries

| Field     | Meaning                                                                     |
| --------- | --------------------------------------------------------------------------- |
| `key`     | Unique within the screen. Stable across requests (use for diffing/analytics). |
| `type`    | Island type. MUST be one the client declared.                              |
| `version` | Island version. MUST be one the client declared for that type.            |
| `status`  | `ok` or `error`; `pending` in a stream's head, for an island still being resolved (§4.6). |
| `props`   | Present iff `status` is `ok`. MUST validate against the manifest.         |
| `error`   | Present iff `status` is `error`. `{ code, retryable?, message? }`.        |
| `next`    | Optional, only with `status: "ok"`. The island has more pages: an opaque cursor for its next one (§4.5). |

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
- If the screen exists but what its params refer to doesn't (a deleted recipe, a mistyped
  id), the composer responds `404` with error code `not_found`, distinct from
  `unknown_screen`. Clients show their own not-found UI.
- If the screen needs a signed-in user and there isn't one, the composer responds `401`
  `unauthenticated`. If the user may not see it, it responds `403` `forbidden`. Clients
  typically send the user to sign in or show their own "no access" UI.
- Unknown fields in any payload MUST be ignored by both sides (forward compatibility).

### 4.4 Client rendering rules

- Render islands in array order.
- If the client receives an island/version it didn't declare (a composer bug), it MUST
  skip it rather than crash.
- If an island has a `status` the client doesn't recognise, it MUST skip it.
- A `pending` island (§4.6) MAY be shown as a placeholder of the client's own until its line
  arrives, or the client MAY wait for the whole stream before showing the screen. Placeholders
  are the client's: the protocol says nothing about how a pending island looks.
- Typed clients (Swift, Kotlin, …) that fail to decode an island's props MUST skip that
  island rather than fail the screen, and SHOULD report it.
- Props SHOULD be validated client-side in debug builds only.

### 4.5 Island requests

Some islands are long lists people scroll through: a feed, search results, comments. A screen
sends their first page, and an island request fetches the next. The same request without a
cursor resolves one island again, so a client can refresh it without the whole screen.

An island entry with more pages carries `next`, an opaque string made by the composer's app. To
fetch that page, a client sends `POST {base}/screens/{screen}/islands/{key}`
(`schema/island-request.schema.json`):

```json
{
  "protocol": 0,
  "screen": "search",
  "key": "results",
  "version": 1,
  "params": { "q": "pasta" },
  "client": { "platform": "ios", "appVersion": "4.2.0" },
  "cursor": "eyJuIjoyMH0"
}
```

| Field      | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `screen`, `key` | The screen, and the island's key on it. Also in the path.                 |
| `version`  | The island version the client is showing. Pages are resolved at that version.  |
| `params`, `client` | As for the screen (§3): the same params the screen was requested with. |
| `cursor`   | Optional. The entry's `next`. Without it, the island is resolved again from its first page. |

The composer answers `200` with the island as an entry (§4.1), alone
(`schema/island-response.schema.json`):

```json
{
  "protocol": 0,
  "screen": "search",
  "island": {
    "key": "results",
    "type": "result-list",
    "version": 1,
    "status": "ok",
    "props": { "items": [ … ] },
    "next": "eyJuIjo0MH0"
  }
}
```

- **A page is the island's props**, holding that page's content: no new schema. How pages combine
  (usually, appending their items) is the island's business; fields that only matter on the first
  page can be optional.
- **The screen is laid out as it would be**: its requirements, its layout and each placement's
  condition run for the request, so a page answers 401, 403 or 404 just as the screen would. The
  island's resolver sees the cursor.
- **A cursor belongs to the app**: it carries whatever the app needs to go on (an offset, the time
  the first page was made, so later additions don't push the list along). Composers pass it
  through; clients never make or read one.
- **Nothing changes**: an island request has no effects. Clients MAY cache it like a screen.
- **Failure is the island's**: if it fails, the response is `200` with an entry whose `status` is
  `error` (§4.3). `required` doesn't apply.

| Situation                                         | Status | `error.code`                 |
| ------------------------------------------------- | ------ | ---------------------------- |
| The screen, or the key on it, doesn't exist for this request (unknown, or its condition is false) | 404 | `unknown_island` (`unknown_screen` for the screen) |
| The placement has no version `version`            | 400    | `unsupported_island_version` |
| A cursor for an island without pages, or one its app rejects | 400 | `invalid_cursor`   |
| Body `screen` or `key` differs from the path      | 400    | `island_mismatch`            |

Other failures are as for screens (§8.1): `bad_request`, `unsupported_protocol`, `not_found`,
`unauthenticated`, `forbidden`, `layout_failed`.

Clients that don't page or refresh islands ignore `next` (§4.3: unknown fields are ignored).

### 4.6 Streams

A composer answers a screen with `200`, `Content-Type: application/jsonl`, and a stream of JSON
objects, one per line, each ending in a newline (`schema/screen-stream-line.schema.json`). Each
line's `kind` says what it is:

```jsonl
{"kind":"head","protocol":0,"screen":"recipe","meta":{"title":"Charred broccoli"},"islands":[{"key":"recipe","type":"recipe","version":1,"status":"ok","props":{…}},{"key":"more","type":"recipe-list","version":1,"status":"pending"},{"key":"comments","type":"comment-list","version":1,"status":"pending"}]}
{"kind":"island","island":{"key":"comments","type":"comment-list","version":1,"status":"ok","props":{…},"next":"c2"}}
{"kind":"island","island":{"key":"more","type":"recipe-list","version":1,"status":"error","error":{"code":"timeout","retryable":true}}}
{"kind":"end"}
```

1. **`head`**, first and once: the screen response (§4), whose islands are the screen's, in
   order, each either resolved (`ok` or `error`) or `pending`, with its key, type and version and
   nothing else. A client can lay the whole screen out from it.
2. **`island`**, once for each pending island, as it's resolved, in any order: its entry (§4.1),
   as an island request answers it (§4.5). Its key says where it goes.
3. **`end`**, last: the screen is complete.

What can fail the whole screen is settled before the head, so a screen's status is known before
anything is sent:

- its requirements and layout, including each placement's condition, so the head's islands are
  the screen's (§4.3: `401`, `403`, `404`, `layout_failed`);
- its required islands, which are resolved in the head, never pending (`required_island_failed`,
  `required_island_unsupported`);
- its `meta` and `cache`, which are in the head.

A failure before the head is answered as today: a non-2xx status with a JSON error body (§4.3).
A client checks the status before reading lines.

Islands that aren't required MAY be resolved in the head, if they're ready when it's sent, or
pending. A screen whose islands are all ready is a head and an `end`.

If a stream ends without `end` (the connection dropped), each island still pending is an error
with code `incomplete`, `retryable: true`, as if the composer had sent it. Clients MUST ignore
lines with a `kind` they don't recognise, and an `island` line for a key that isn't pending.

Island requests (§4.5) and actions (§5) aren't streams: each answers with one JSON body.

---

## 5. Actions

Screens read; **actions** change things (create a post, follow a user, sign in). An action is a
typed request/response call to the composer, described by a manifest like an island, so every
platform gets generated input, result and error types.

Interactivity that doesn't change server state (expanding a card, local form state) stays the
island's own business. The protocol never ships behaviour to clients.

### 5.1 Action manifests

Each action version is described by a manifest (`schema/action-manifest.schema.json`):

```json
{
  "action": "follow-user",
  "version": 1,
  "description": "Follow a user.",
  "input": {
    "type": "object",
    "required": ["userId"],
    "properties": { "userId": { "type": "string" } }
  },
  "result": {
    "type": "object",
    "required": ["followers"],
    "properties": { "followers": { "type": "integer" } }
  },
  "errors": {
    "blocked": { "description": "The user has blocked the caller." },
    "limit_reached": {
      "description": "The caller follows too many users.",
      "details": {
        "type": "object",
        "required": ["limit"],
        "properties": { "limit": { "type": "integer" } }
      }
    }
  }
}
```

- `action` is kebab-case and `version` a positive integer, as for islands.
- `input` and `result` are object schemas in the codegen subset (§2). `result` may be an object
  with no properties.
- `errors` declares the **expected** failures, keyed by snake_case code. These are outcomes the
  caller should handle, such as a name that's taken, not faults. Each may have a `details` object
  schema. Without `errors`, the action declares no errors.

Within a version, a change MUST keep released clients working in both directions:

- `input`, `result` and each error's `details` follow the same rules as island props (§2).
  Optional properties MAY be added or removed; anything else is a new version.
- Error codes MAY be added or removed. A client receiving a code it doesn't know MUST treat it
  as a generic failure.

The `codegen compat` command checks these rules.

### 5.2 Request

`POST {base}/actions/{action}` with body (`schema/action-request.schema.json`):

```json
{
  "protocol": 0,
  "action": "follow-user",
  "version": 1,
  "input": { "userId": "u_123" },
  "client": { "platform": "ios", "appVersion": "4.2.0" },
  "idempotencyKey": "6f1c0f7e-0d8e-4c55-9d1a-3f1f0b6d1c2a"
}
```

| Field            | Meaning                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `protocol`       | Protocol major version the client speaks.                                 |
| `action`         | Action identifier. Also in the path for routing.                          |
| `version`        | The action version the client was built against.                         |
| `input`          | MUST validate against that version's `input` schema.                      |
| `client`         | As for screens (§3).                                                      |
| `idempotencyKey` | Optional. One per user intent, reused when retrying it.                    |

Clients call exactly one version; there is no negotiation. Composers keep serving old action
versions for as long as released clients call them.

The composer MUST validate `input` against the manifest before calling the action. Unknown
properties are ignored, and a `null` optional property is treated as absent. Composers pass
`idempotencyKey` through to the action. Honouring it (returning the first outcome again
rather than repeating the change) is the action's job, because only the backend knows where
the result was stored.

Identity and auth travel in transport headers, as for screens.

### 5.3 Response

An action that ran responds `200` with an outcome (`schema/action-response.schema.json`).
Success:

```json
{
  "protocol": 0,
  "action": "follow-user",
  "version": 1,
  "status": "ok",
  "result": { "followers": 1043 },
  "effects": {
    "invalidate": [{ "screen": "profile", "params": { "userId": "u_123" } }, { "screen": "feed" }],
    "navigate": { "screen": "profile", "params": { "userId": "u_123" } }
  }
}
```

A declared error:

```json
{
  "protocol": 0,
  "action": "follow-user",
  "version": 1,
  "status": "error",
  "error": { "code": "limit_reached", "details": { "limit": 5000 } }
}
```

- `result` MUST validate against the manifest's `result` schema.
- `error.code` MUST be one of the version's declared errors. `details` is present exactly when
  that error declares a `details` schema, and MUST validate against it. `message` is optional and
  meant for logs. Clients show their own copy, chosen by `code`.
- Anything else (an undeclared error, a crash, invalid input) is not an outcome: the composer
  responds non-2xx with `{ "protocol": 0, "error": { "code": "...", "message": "..." } }` (§8.1).

#### Effects

`effects` is optional and only present on success. It tells clients what the action changed, so
that every platform reacts the same way without hard-coding it:

| Field        | Meaning                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| `invalidate` | Screens whose content may have changed. Clients SHOULD drop cached responses for them and reload the ones currently shown. |
| `navigate`   | A screen to show next. Clients map it to their own routes, and MAY ignore it. |

Both use a **screen reference** `{ "screen": "...", "params": { ... } }`. A reference matches a
screen with the same id whose params include every param in the reference. So
`{ "screen": "feed" }` matches every `feed`, whatever its params.

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

- **Islands that turn out not to be shown**: a placement's condition settled after a stream's head
  (§4.6), so a screen whose conditions need slow data can send its head sooner. The island would
  start pending, and its line could say it isn't shown.
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

`required` and `timeoutMs` map to the composer's own placement options. A mock's `startDelayMs`
(without `load`) delays it before it resolves or fails. If `params.placements` is not valid JSON,
the screen's layout fails. The runner then sends each case in `conformance/composer/cases.json`
and checks status codes and bodies. For a `200`, it reads the stream, checks it (§4.6: a head
first, one line per pending island, `end` last), and puts it together to compare the screen; a
case's `expect.pending` lists the keys that must be pending in the head, and `expect.resolved`
those that must not be.

The `__conformance` screen also reads three optional params:
- `meta` (JSON) is returned as the response's `meta`.
- `notFound`: `"true"` makes the screen respond `not_found`.
- `auth`: `"unauthenticated"` or `"forbidden"` makes the screen respond with that error.

If a mock has `pages` (a number), the island has that many pages (§4.5). Its resolver for version
`n` resolves page `p` to `{ "v": n, "page": p }`, with `next` set to `"page:<p+1>"` until the last
page. Without a cursor it resolves page 1; a cursor it didn't make is `invalid_cursor`. A mock
without `pages` has none, so any cursor is `invalid_cursor`.

If a mock has `load` (a key), its resolver first waits `startDelayMs`, then calls the composer's
request-scoped load (§9) with that key and work that counts how often it runs, takes `loadDelayMs`,
and fails if its cancellation signal fires. It then resolves to `{ "v": n, "calls": <runs of that
key's work so far in this request> }`.

The runner also sends each case in `conformance/composer/island-cases.json` as an island request
(§4.5) for the `__conformance` screen, with the case's placements in its params.

The `__conformance` screen MUST NOT be registered in production builds.

Error codes the suite checks, for composers to use consistently:

| Situation                                  | Status | `error.code`                  |
| ------------------------------------------ | ------ | ----------------------------- |
| Body isn't valid JSON or misses fields     | 400    | `bad_request`                 |
| `protocol` not supported                   | 400    | `unsupported_protocol`        |
| Body `screen` differs from path            | 400    | `screen_mismatch`             |
| Unknown screen                             | 404    | `unknown_screen`              |
| Screen's params refer to nothing           | 404    | `not_found`                   |
| No signed-in user, and the screen needs one | 401   | `unauthenticated`             |
| The user may not see the screen            | 403    | `forbidden`                   |
| Screen layout itself failed                | 500    | `layout_failed`               |
| Required island has no common version      | 502    | `required_island_unsupported` |
| Required island failed                     | 502    | `required_island_failed`      |
| Island failed (in-body, status 200)        | —      | `resolve_failed`              |
| Island timed out (in-body, status 200)     | —      | `timeout` (`retryable: true`) |

#### Actions

The conformance server also registers the test-only action `conformance`, versions 1 and 2. It
is described by `conformance/composer/actions/conformance.v1.json`; v2 is the same with `version: 2`. The
action's `input.outcome` decides what happens:

| `outcome`          | Behaviour                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| `ok`               | succeeds with result `{ "echo": input.echo, "version": n, "idempotencyKey": <the request's key, if any> }` and, if `input.effects` is set, those effects |
| `rejected`         | fails with the declared error `rejected`, details `{ "echo": input.echo }`   |
| `unavailable`      | fails with the declared error `unavailable` (no details)                    |
| `undeclared`       | fails with an error code the manifest doesn't declare                       |
| `fail`             | fails with an ordinary error                                                 |
| `not_found`, `unauthenticated`, `forbidden` | fails with that protocol error                       |

The runner POSTs each case in `conformance/composer/action-cases.json` to
`{base}/actions/{action}`.

| Situation                                   | Status | `error.code`                  |
| ------------------------------------------- | ------ | ----------------------------- |
| Body isn't valid JSON or misses fields      | 400    | `bad_request`                 |
| `protocol` not supported                    | 400    | `unsupported_protocol`        |
| Body `action` differs from path             | 400    | `action_mismatch`             |
| `input` doesn't validate                    | 400    | `invalid_input`               |
| Unknown action                              | 404    | `unknown_action`              |
| Known action, version not served            | 404    | `unsupported_action_version`  |
| What the input refers to doesn't exist      | 404    | `not_found`                   |
| No signed-in user, and the action needs one | 401    | `unauthenticated`             |
| The user may not perform the action         | 403    | `forbidden`                   |
| The action failed, or returned an undeclared error | 500 | `action_failed`          |

### 8.2 Client conformance (fixtures)

`conformance/client/cases.json` holds registry setups, raw response streams (§4.6, as an array of
lines) and the expected render output. Each client implementation runs them in its own unit tests, using a test
renderer that outputs `"{type}@{version}:{props.v}"` and, when a case sets
`renderErrors`, an error fallback that outputs `"error:{key}:{error.code}"`.

`conformance/client/action-cases.json` covers actions and effects: the request a client builds,
how it classifies each kind of response (a result with its effects, a declared error, or a
failure, which includes error codes the action doesn't declare), how screen references match
screens (§5.3), and the error code a failed screen request exposes.

---

## 9. Request-scoped loading (composer implementations)

Several islands on one screen often need the same data (the header and the follow button both
need the profile's user). Composer cores MUST provide a request-scoped load:

- `load(key, work)` runs `work` at most once per key per screen request, and every caller in that
  request (other islands and the layout) receives the same result or error.
- `work` runs under the **request's** lifetime, not the calling island's: an island timing out MUST
  NOT cancel work that other islands are waiting on. Each caller still stops waiting at its own
  timeout.
- Work still running when the stream ends is cancelled.
- Results are never shared between requests.

Cores SHOULD also offer a batch loader that combines keys requested by different islands in the same
request into one call. Caching across requests is out of scope here: it belongs in the services a
composer calls, where cache keys can account for who is asking.

The conformance suite checks the MUST rules (§8.1).
