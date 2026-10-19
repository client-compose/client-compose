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

**Start with [`examples/profile`](examples/profile)**: native iOS and Android apps backed by a Go
composer.

## Implementations

The protocol is the product; implementations are per stack and mostly community-maintained.
Every implementation passes the shared [conformance suites](conformance/).

| Role     | Stack                     | Path                       | Tier | Protocol |
| -------- | ------------------------- | -------------------------- | ---- | -------- |
| Composer | Go (`net/http`)           | `composers/go/core`        | Core | v0       |
| Composer | TypeScript (`node:http`)  | `composers/typescript`     | Core | v0       |
| Client   | Swift (+ SwiftUI)         | `clients/swift`            | Core | v0       |
| Client   | Kotlin (JVM / Android)    | `clients/kotlin`           | Core | v0       |
| Client   | TypeScript                | `clients/typescript`       | Core | v0       |

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

Each implementation has its own README and test command. To run TypeScript plus the conformance
runner:

```sh
pnpm install
pnpm typecheck
pnpm test
```

## Roadmap

- [x] Codegen: island manifests → Go, Swift, Kotlin, TypeScript ([codegen/](codegen/))
- [ ] Codegen: a lint that flags breaking manifest changes made without a version bump
- [ ] Codegen distributed without needing Node (e.g. a standalone binary)
- [ ] Jetpack Compose binding (`ComposedScreen`) and Kotlin Multiplatform targets
- [ ] React / React Native binding
- [ ] More composer adapters: chi/gin/echo (Go), Express/Fastify/Hono/Lambda (TS)
- [ ] v1 candidates in `spec/PROTOCOL.md` §7 (streaming, single-island refresh)
