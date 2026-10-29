# Client Compose

Server-composed screens, made of components your app already owns.

Client Compose is a **protocol** between an app and its backend-for-frontend, the **composer**.
Your app knows how to draw a handful of **islands**: a profile header, a post grid, a follow
button. The composer decides which islands make up each screen, in what order, and with what data.
Change the composer, and every app that's already installed picks it up, as long as it knows how to
draw the islands you send.

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

It isn't only the UI that gets stuck. An installed app also carries its networking: which endpoints
to call, what to send them and how to read what comes back. When the backend changes, every old
build still expects the old shapes, so you either keep those endpoints alive indefinitely or accept
that some older versions will just break.

The usual fix is server-driven UI: describe the whole interface from the server. That works until
the schema grows rows and columns and padding and conditionals, and you've built a second UI
framework, a worse one, that every app has to interpret.

Client Compose sits in between. The server decides *what's on the screen*. The app decides *what it
looks like* and *how it behaves*. The contract between them is a flat, ordered list of islands, each
a versioned set of typed props. No layout trees, no styling, no logic sent over the wire. And
because the app only ever talks to the composer, the code that knows about your services lives on
the server, where you can change it.

## The protocol

The [spec](spec/PROTOCOL.md) is short, and nothing in it depends on a language or a UI framework.
An app and its composer share only two things: the protocol, and your **manifests**, the JSON
Schema files that describe your islands and actions.

- **Islands** (§2–4) are versioned, typed sets of props. A screen is an ordered list of them. Each
  request says which versions the app can draw, and the composer sends the newest both sides know.
  An island that fails is reported on its own, and the rest of the screen still renders.
- **Streams** (§4.6) send a screen's head as soon as it's settled, and slow islands after it.
- **Island requests** (§4.5) fetch an island's next page, or refresh one island without its screen.
- **Actions** (§5) change things. Their inputs, results and declared errors are typed, and their
  **effects** tell apps which screens to reload, or where to go next.
- **Strings** (§4.7) carry every word an app shows, in the person's language, with plurals by
  CLDR's rules, so copy and new languages ship without an app release.

[Conformance suites](conformance) pin the behaviour down: composers are tested over HTTP, clients
against shared fixtures. Every implementation here passes them, and
[`spec/CAPABILITIES.md`](spec/CAPABILITIES.md) says exactly what each one provides.

## Mix and match

Because a composer and an app share nothing but the protocol and the manifests, **any composer
works with any client**. Write your composer in the language your backend team knows, and each app
in whatever suits its platform:

- a Go composer, serving a React web app and a React Native app;
- a TypeScript composer on Node, serving the same apps;
- a TypeScript composer, serving a Next.js site rendered with Server Components;
- several apps on one composer, each drawing the islands it knows.

[Codegen](codegen) turns the manifests into types for each side, so a composer in Go and an app in
TypeScript agree on every prop at compile time. A client for any other platform only has to speak
the protocol.

| | Implementation | Install |
| --- | --- | --- |
| Composer | [Go](composers/go/core): `net/http`, so chi, gin and echo too | `go get github.com/client-compose/client-compose/composers/go/core` |
| Composer | [TypeScript](composers/typescript/core): Bun, Deno, Workers, Hono and Next.js through `fetch`; Node with [`node:http`](composers/typescript/node-http), [Express](composers/typescript/express) or [Fastify](composers/typescript/fastify) | `npm install @client-compose/composer` |
| Client | [React and React Native](clients/typescript/react), with server rendering and Server Components | `npm install @client-compose/react` |
| Client | [Plain TypeScript](clients/typescript/core), for anything else that renders | `npm install @client-compose/client` |
| Codegen | [Types for every language](codegen), from your manifests | `npm install -D @client-compose/codegen`, or a [standalone binary](codegen#install) |

Each README covers setup, testing and the full API.

## Examples

[`examples/todo`](examples/todo) is the classic todo app, built on one set of manifests: one
composer per language, and one app per client. Run any composer and point any app at it.

| Composers | Clients |
| --- | --- |
| [Go](examples/todo/composer-go) | [React web (Vite)](examples/todo/web) |
| [TypeScript on Node](examples/todo/composer-ts) | [Next.js, with Server Components](examples/todo/next) |
| | [React Native (Expo)](examples/todo/react-native) |

Every composer passes [the same suite](examples/todo/tests), over HTTP.

## What it looks like in code

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

[Codegen](codegen) turns that into types for each side: a `ProfileHeaderV2` struct in Go, an
interface in TypeScript.

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

Those are plain React components, on the web or in React Native. The same screen could come from
the Go composer instead: see [mix and match](#mix-and-match).

## What you get

**Your app stays yours.** Islands are ordinary components with ordinary props. You keep your design
system, your animations, your accessibility work and your local state. The server never sends a
layout.

**Old apps keep working.** Every request says which island versions the app can draw, and the
composer sends the newest version both sides know. An app from two years ago gets v1 of the header
from the same endpoint that gives today's app v2. `codegen compat` catches a breaking change to a
released version before it ships.

**Backend changes stay on the backend.** The app doesn't call your services, so it doesn't ship
their endpoints, request shapes or response parsing. It asks for screens and performs actions, and
the composer does the rest. When a service changes, you update the composer and deploy it. The
adapting for each app version happens there too: last year's build still sends v1 of an action,
and the composer maps it onto the new API. When an old version really can't be supported any more,
you stop serving that island and old apps show the rest of the screen without it, instead of
breaking.

**One slow service doesn't take the screen down.** Islands resolve in parallel, each with its own
timeout. If the posts service is down, the header still renders, and the posts island comes back as
an error the app can hide or retry. Mark an island `required` when the screen means nothing without
it.

**Changes are typed too.** Actions (`follow-user`, `rename-recipe`) are described like islands, with
input, result and the errors callers should handle, so every platform gets generated types. An
action's response says which screens it changed, and screens on display reload by themselves.

**Copy ships from the server.** Every word an app shows comes from the composer, in the user's
language, so copy changes and new languages go live without an app release. Islands get typed
strings, counted ones pick their words by CLDR's plural rules on every platform, and a catalog check
keeps every language complete.

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

## Status

Client Compose is young: everything is 0.x and the protocol is v0. Expect breaking changes while it
settles, each called out in the changelogs. It's built alongside a real app with web and React
Native clients on the Go composer, and most of the design comes from what that app needed.

On the way:

- An AWS Lambda adapter for the TypeScript composer

**Wanted: maintainers for Swift and Kotlin.** There were clients for SwiftUI and Jetpack Compose
here. They were removed because nobody could look after them properly, and they're welcome back
with someone who can: open an issue to take one on.

## Adding an implementation

Anything that can make an HTTP request and render a list can be a client, and anything that can
serve one can be a composer. What a new implementation has to do is spelled out:

- **A composer** in another language (Python, Ruby, Kotlin on the server, Rust, .NET…) passes the
  [composer conformance suite](conformance), which runs over HTTP against your server, so it needs
  nothing from your language. The todo example's [suite](examples/todo/tests) is a good next step.
- **A client** for another platform loads the shared fixtures in its own tests: rendering, actions
  and effects.
- **A UI binding** for another framework (Vue, Svelte, Solid, SwiftUI, Jetpack Compose, Flutter…)
  sits on a client core. The React binding shows the shape.
- **A framework adapter** for an existing composer (Hono, Koa, Lambda, Gin…) is usually a few lines.

[CONTRIBUTING.md](CONTRIBUTING.md) walks through adding one.

## This repository

| Path | What |
| --- | --- |
| [`spec/`](spec) | The protocol, its JSON Schemas, and what every implementation provides |
| [`conformance/`](conformance) | Test suites for composers (over HTTP) and clients (fixtures), in any language |
| [`composers/`](composers) | Composers: Go, and TypeScript with its adapters |
| [`clients/`](clients) | Clients: TypeScript, and React |
| [`codegen/`](codegen) | Types from manifests, and the compatibility check |
| [`examples/`](examples) | A todo app: one composer per language, one app per client, all interchangeable |

To work on it:

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # TypeScript
pnpm check-packages                        # build, pack and install-test the npm packages
(cd composers/go/core && go test ./...)    # Go
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers adding a language, a framework adapter or a UI binding, and
changing the protocol. [RELEASING.md](RELEASING.md) covers how packages are published.

## License

[MIT](LICENSE)
