# client-compose

A small protocol for **server-composed screens made of client-owned islands**.

Native release cycles (store review, users who never update) make UI changes slow.
Full server-driven UI fixes that by describing the whole UI from the server, and the
schema ends up as a second, worse UI framework. Client Compose sits in between:

- The **app** owns *how* things look and behave. It registers **islands**
  (e.g. `profile-header`) and the versions of them it can render.
- The **composer** (a backend-for-frontend) owns *which* islands appear on a screen,
  in what order, and resolves each island's **props** by calling your backend services.
- The contract between them is a flat list of `{ key, type, version, props }`.

```
 app                            composer                       services
 ───                            ────────                       ────────
 POST /screens/profile   ──▶    layout(): [header, posts]
   islands: {                   negotiate versions      ──▶    users.get()
     profile-header: [1,2],     resolve props in parallel ──▶  posts.recent()
     post-grid: [1] }           isolate failures
                         ◀──    [{header, v2, props}, {posts, v1, error}]
 render in order
```

You can move, add, remove, A/B test, or re-source islands without shipping an app
update, as long as the app already has a renderer for that island.

**Start with [`examples/profile`](examples/profile)**: one Go composer serving native iOS (SwiftUI),
native Android (Compose), React web and React Native apps.

## Implementations

The protocol is the product; implementations are per stack and mostly community-maintained.
Every implementation passes the shared [conformance suites](conformance/).

| Role     | Stack                     | Path                       | Tier | Protocol |
| -------- | ------------------------- | -------------------------- | ---- | -------- |
| Composer | Go (`net/http`)           | `composers/go/core`        | Core | v0       |
| Composer | TypeScript (`node:http`)  | `composers/typescript`     | Core | v0       |
| Client   | Swift (+ SwiftUI)         | `clients/swift`            | Core | v0       |
| Client   | Kotlin (JVM / Android)    | `clients/kotlin`           | Core | v0       |
| Client   | TypeScript                | `clients/typescript/core`  | Core | v0       |
| Client   | React / React Native      | `clients/typescript/react` | Core | v0       |

Using a stack that isn't listed? See [CONTRIBUTING.md](CONTRIBUTING.md). Adding a framework
adapter for an existing core is usually under 50 lines.

## Repo layout

| Path            | What                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `spec/`         | **The protocol** (`PROTOCOL.md`) and JSON Schemas.                      |
| `conformance/`  | Language-neutral test suites for composers (over HTTP) and clients (fixtures). |
| `composers/`    | Composer implementations: `<language>/core` + `<language>/<framework>`. |
| `clients/`      | Client implementations: `<platform>/core` + optional UI bindings.       |
| `shared/`       | Code shared between implementations in one language.                    |
| `codegen/`      | Generates island props types (Go, Swift, Kotlin, TypeScript) from manifests. |
| `examples/`     | End-to-end examples across stacks.                                      |
| `Package.swift` | Exposes `clients/swift` to SwiftPM, which requires a manifest at the repo root. |

## Development

Each implementation has its own README and test command. For the TypeScript packages
(Node 24+ in this repo; the published packages need Node 20+):

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm check-packages   # build, pack, lint and install-test the npm packages
```

Releases are managed with Changesets; see [RELEASING.md](RELEASING.md).

## npm packages

| Package | What |
| --- | --- |
| [`@client-compose/react`](clients/typescript/react) | React and React Native bindings |
| [`@client-compose/client`](clients/typescript/core) | Framework-agnostic client |
| [`@client-compose/composer`](composers/typescript/core) | Framework-agnostic composer |
| [`@client-compose/node-http`](composers/typescript/node-http) | `node:http` adapter for the composer |
| [`@client-compose/codegen`](codegen) | Props types for Go, Swift, Kotlin and TypeScript from manifests |
| [`@client-compose/conformance`](conformance/runner) | Conformance suites and runner, for implementations in any language |
| [`@client-compose/protocol`](shared/typescript/protocol) | Wire types |

## Roadmap

- [x] Codegen: island manifests → Go, Swift, Kotlin, TypeScript ([codegen/](codegen/))
- [x] Codegen: `compat` lint that flags breaking manifest changes made without a version bump
- [x] Codegen: standalone binaries, no Node needed ([install](codegen/README.md#install))
- [ ] Jetpack Compose binding (`ComposedScreen`) and Kotlin Multiplatform targets
- [x] React / React Native binding ([clients/typescript/react](clients/typescript/react))
- [x] TypeScript packages ready for npm (see [RELEASING.md](RELEASING.md))
- [ ] More composer adapters: chi/gin/echo (Go), Express/Fastify/Hono/Lambda (TS)
- [ ] v1 candidates in `spec/PROTOCOL.md` §7 (streaming, single-island refresh)
