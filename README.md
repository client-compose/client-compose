# Client Compose

Server-composed screens, made of components your app already owns.

Your app knows how to draw a handful of **islands**: a profile header, a post grid, a follow button.
Your server decides which islands make up each screen, in what order, and with what data. Change
the server, and every app that's already installed picks it up, as long as it knows how to draw the
islands you send.

The protocol is language-neutral. This repo has composers in Go and TypeScript and clients for
React, React Native, SwiftUI and Jetpack Compose, and new ones for other languages and UI frameworks
are welcome.

```
 app                              composer (your backend-for-frontend)         services
 ───                              ────────────────────────────────────         ────────
 POST /screens/profile     ──▶    which islands? [header, follow, posts]
   "I can draw:                   pick versions both sides know       ──▶      users.get()
    profile-header v1, v2         resolve props in parallel           ──▶      posts.recent()
    post-grid v1"                 isolate failures
                           ◀──    [ header v2 {…}, posts v1 error: timeout ]
 draws them, in order
```

## Why this exists

Native apps change slowly. A UI change waits on store review, then on people updating, and some of
them never do. On the web you deploy and you're done; on mobile you're supporting last year's build
for years.

The usual fix is server-driven UI: describe the whole interface from the server. That works until
the schema grows rows and columns and padding and conditionals, and you've built a second UI
framework, a worse one, that every app has to interpret.

Client Compose sits in between. The server decides *what's on the screen*. The app decides *what it
looks like* and *how it behaves*. The contract between them is a flat, ordered list of islands, each
a versioned set of typed props. No layout trees, no styling, no logic sent over the wire.

## What it looks like

An island is described once, as JSON Schema:

```json
{
  "type": "profile-header",
  "version": 2,
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

[Codegen](codegen) turns that into types for every language you use: a `ProfileHeaderV2` struct in Go
and Swift, a data class in Kotlin, an interface in TypeScript.

The **composer** declares the screen, and resolves each island from your services:

```ts
import { createComposer, island, place, screen } from "@client-compose/composer";

const ProfileHeader = island(ProfileHeaderV2, async ({ params }) => {
  const user = await users.get(params.userId);
  return { displayName: user.name, avatarUrl: user.avatar, badge: user.pro ? "PRO" : undefined };
});

const profile = screen("profile", {
  islands: [
    place("header", ProfileHeader, { required: true }),
    place("posts", PostGrid, { timeoutMs: 300 }),
  ],
});

export default { fetch: createComposer({ screens: [profile] }).fetch };
```

The **app** registers a component for each island it can draw, then asks for screens:

```tsx
const registry = new ReactIslandRegistry()
  .registerComponent(ProfileHeaderV2, ProfileHeader)
  .registerComponent(PostGridV1, PostGrid);

// inside a <ClientComposeProvider> with the registry and your composer's URL
<ComposedScreen screen="profile" params={{ userId }} />
```

Those are plain React components. In SwiftUI and Jetpack Compose it's the same idea, with the same
generated types:

```swift
ComposedScreen("profile", params: ["userId": userId])
```

```kotlin
ComposedScreen("profile", mapOf("userId" to userId))
```

[`examples/profile`](examples/profile) has the whole thing running: one Go composer serving an iOS
app, an Android app, a React web app, a Next.js app and a React Native app.

## What you get

**Your app stays yours.** Islands are ordinary components with ordinary props. You keep your design
system, your animations, your accessibility work and your local state. The server never sends a
layout.

**Old apps keep working.** Every request says which island versions the app can draw, and the
composer sends the newest version both sides know. An app from two years ago gets v1 of the header
from the same endpoint that gives today's app v2. `codegen compat` catches a breaking change to a
released version before it ships.

**One slow service doesn't take the screen down.** Islands resolve in parallel, each with its own
timeout. If the posts service is down, the header still renders, and the posts island comes back as
an error the app can hide or retry. Mark an island `required` when the screen means nothing without
it.

**Changes are typed too.** Actions (`follow-user`, `rename-recipe`) are described like islands, with
input, result and the errors callers should handle, so every platform gets generated types. An
action's response says which screens it changed, and screens on display reload by themselves.

**Requests share their data.** When three islands need the same user, `load` fetches it once per
request, and batch loaders combine lookups across islands into one call.

**It's yours to wire up.** The composer doesn't pick your auth, database or cache. Auth is a function
from the request to your own context, plus requirements like "signed in" on screens and actions.
Caching island props, or making retried actions safe, are optional adapters you implement over
whatever you already run. Leave them out and those features are simply off.

**You can test it without a server.** Both composers come with a test kit that calls them
in-process with typed results. Every client has a fake composer that answers with the generated
types and records what the app sent.

**Every implementation behaves the same.** A [protocol spec](spec/PROTOCOL.md) and language-neutral
[conformance suites](conformance) pin down the behaviour, and every composer and client in this repo
passes them. [`spec/CAPABILITIES.md`](spec/CAPABILITIES.md) lists what each implementation provides,
so "supports Client Compose" means something specific.

## When it isn't a good fit

- **Web-only, deployed continuously.** If you ship whenever you like and nobody runs an old build,
  most of the benefit isn't there. You may still like the composer as a backend-for-frontend.
- **Every screen is unique.** If nothing is reused and every change is a new design, you'll be adding
  islands, and new islands still need an app release.
- **You want pixel control from the server.** That's what this deliberately doesn't do.

## Getting started

Pick a composer and a client. Each has a README covering setup, testing and the full API.

| | Stack | Install |
| --- | --- | --- |
| Composer | [Go](composers/go/core) (`net/http`, so chi, gin, echo too) | `go get github.com/client-compose/client-compose/composers/go/core` |
| Composer | [TypeScript](composers/typescript/core): Bun, Deno, Workers, Hono and Next.js through `fetch`; Node with [`node:http`](composers/typescript/node-http), [Express](composers/typescript/express) or [Fastify](composers/typescript/fastify) | `npm install @client-compose/composer` |
| Client | [React, React Native, server rendering and Server Components](clients/typescript/react) | `npm install @client-compose/react` |
| Client | [Swift and SwiftUI](clients/swift) | Swift Package Manager, from this repository |
| Client | [Kotlin and Jetpack Compose](clients/kotlin) | from source, for now |
| Client | [Plain TypeScript](clients/typescript/core), for anything else that renders | `npm install @client-compose/client` |
| Codegen | [Types for every language](codegen), from your manifests | `npm install -D @client-compose/codegen`, or a [standalone binary](codegen#install) |

### Your stack isn't listed?

Contribute it. The protocol is a short [spec](spec/PROTOCOL.md), and nothing in it depends on Go,
TypeScript or any UI framework. Anything that can make an HTTP request and render a list can be a
client, and anything that can serve one can be a composer. What a new implementation has to do is
spelled out:

- **A composer** in another language (Python, Ruby, Kotlin on the server, Rust, .NET…) passes the
  [composer conformance suite](conformance), which runs over HTTP against your server, so it needs
  nothing from your language.
- **A client** for another platform loads the shared fixtures in its own tests: rendering, actions
  and effects.
- **A UI binding** for another framework (Vue, Svelte, Solid, UIKit, Flutter…) usually sits on an
  existing client core. The React, SwiftUI and Compose bindings show the shape.
- **A framework adapter** for an existing composer (Hono, Koa, Lambda, Gin…) is usually a few lines.

[`spec/CAPABILITIES.md`](spec/CAPABILITIES.md) lists what each layer should provide, and
[CONTRIBUTING.md](CONTRIBUTING.md) walks through adding one.

## Status

Client Compose is young: everything is 0.x and the protocol is v0. Expect breaking changes while it
settles, each called out in the changelogs. It's built alongside a real app, Flavr, whose web and
React Native apps run on the Go composer, and most of the design comes from what that app needed.

On the way:

- Streaming slow islands after fast ones, and refreshing a single island ([protocol §7](spec/PROTOCOL.md#7-open-questions-v1-candidates))
- Kotlin on Maven Central, Swift releases tagged for SwiftPM, and Kotlin Multiplatform
- An AWS Lambda adapter for the TypeScript composer

## This repository

| Path | What |
| --- | --- |
| [`spec/`](spec) | The protocol, its JSON Schemas, and what every implementation provides |
| [`conformance/`](conformance) | Test suites for composers (over HTTP) and clients (fixtures), in any language |
| [`composers/`](composers) | Composers: Go, and TypeScript with its adapters |
| [`clients/`](clients) | Clients: TypeScript and React, Swift and SwiftUI, Kotlin and Compose |
| [`codegen/`](codegen) | Types from manifests, and the compatibility check |
| [`examples/`](examples) | Working examples across stacks |

To work on it:

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # TypeScript
pnpm check-packages                        # build, pack and install-test the npm packages
swift test                                 # Swift, from the repo root
(cd clients/kotlin && ./gradlew test)      # Kotlin
(cd composers/go/core && go test ./...)    # Go
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers adding a language, a framework adapter or a UI binding, and
changing the protocol. [RELEASING.md](RELEASING.md) covers how packages are published.

## License

[MIT](LICENSE)
