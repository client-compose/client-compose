# Capabilities

[`PROTOCOL.md`](PROTOCOL.md) says what goes over the wire. This document says what every
implementation gives the developer using it: who owns what, what each layer must be able to do, and
what it should feel like to use. It's the checklist for parity. A stack is at parity when it ticks
every row for its layer, and wherever a rule can be checked, conformance checks it.

Capabilities have ids (`CMP-3`, `CLI-5`, …). Issues, pull requests and implementation READMEs use
them to say what they add.

## Who owns what

```
 your backend services        composer                      client core          UI binding           your app
 ─────────────────────        ────────                      ───────────          ──────────           ────────
 data, rules, auth   ◀──────  which islands, in what order  capabilities         a screen view        island views,
                              which version (negotiation)   transport            state + reload       styling, routes,
                              props, resolved in parallel   plan (skip rules)    action state         local behaviour
                              actions: validate, run,       actions + outcomes   crash isolation
                              say what changed (effects)    effects, cache       navigate hook
```

- **Composer core.** Decides *what* a screen is: its islands, their order, their version and their
  props. Runs actions and says what they changed. Never decides how anything looks, and has no
  opinion on auth, data sources or caching: those plug in (see
  [The composer as a platform](#the-composer-as-a-platform)).
- **Composer adapter.** HTTP in, core, HTTP out. Holds no protocol logic. If an adapter needs to
  know an error code, the core is missing something.
- **Client core.** Everything a client does that isn't drawing: the registry and capabilities,
  transport, planning a response, calling actions, applying effects and caching. No UI types.
- **UI binding.** Fits the client core to one UI framework's idioms: a screen view, a state holder,
  action state, reloading when a screen is invalidated, and isolating a crashing island.
- **Tooling.** Codegen from manifests, the compatibility lint, conformance, and test kits for both
  sides. Tooling is how the guarantees above stay true as teams change things.
- **Your app.** Island views, styling, navigation and local interactivity. The protocol never
  ships behaviour to clients.

## Composer

| Id | Capability | Spec |
| --- | --- | --- |
| CMP-1 | **Declarative screens.** A screen is declared as data: its islands in order, each with its options (required, timeout, a condition for showing it), its meta, its cache hint and what it requires (CMP-16). A layout function stays for screens whose islands are only known at request time, such as ones from a CMS or an experiment. | §3, §4 |
| CMP-2 | **Islands from generated types.** Define an island version by the generated props type alone; its type and version come from the type. | §2 |
| CMP-3 | **Negotiation.** Several versions per placement; the highest the client declared wins, and an island with no common version is left out. | §4.2 |
| CMP-4 | **Failure isolation.** Islands resolve in parallel, each with a timeout. A failing, panicking or slow island errors on its own. `required` placements fail the screen instead. | §4.3 |
| CMP-5 | **Screen outcomes.** A layout or resolver can say *not found*, *unauthenticated* or *forbidden* by returning or throwing the core's error, without touching HTTP. | §4.3 |
| CMP-6 | **Meta and cache.** Optional screen meta, resolved alongside the islands, never failing the screen; a cache hint per screen. | §4 |
| CMP-7 | **Request-scoped loading.** `load(key, work)` shared by the layout, islands and meta in one request, under the request's lifetime; a batch loader. | §9 |
| CMP-8 | **Actions.** Define an action version by its generated input, result and error types. Input is validated before the handler runs. Declared errors are values; anything else is a failure. | §5 |
| CMP-9 | **Effects and idempotency.** Handlers return effects (`invalidate`, `navigate`) and can read the client's idempotency key. | §5.3 |
| CMP-10 | **One composer.** Screens and actions are registered together and served by one handler. | — |
| CMP-11 | **Error reporting.** Island, layout, meta and action failures reach logs and error tracking, through a plugin (CMP-17). | — |
| CMP-12 | **Adapters.** The language's standard HTTP server, plus the popular frameworks. Mounting a composer is one line; an adapter holds no logic and passes conformance through that framework. | — |
| CMP-13 | **In-process testing.** Call a screen or action from a test without a server, with every island declared, and read the outcome as typed values. | — |
| CMP-14 | **Conformance server.** A test-only binary that passes the composer suite. | §8.1 |
| CMP-15 | **App context.** One function turns the incoming request into the app's own context (the viewer, their locale, a tenant), which every layout, island and action receives. | §3 |
| CMP-16 | **Requirements.** Screens and actions declare what they need, such as a signed-in viewer or a role, and the composer answers 401 or 403 before any of their code runs. What "signed in" means comes from the app context (CMP-15). | §4.3 |
| CMP-17 | **Plugins.** Integrations hook into a composer through a small, documented set of extension points (see [The composer as a platform](#the-composer-as-a-platform)), never by forking or wrapping the core. | — |

## The composer as a platform

React renders UI and does it very well, and it has no opinion on state management, routing or data
fetching. It gives libraries good places to plug in, which is why Redux and React Router felt native
to it without React depending on them. The composer should be that for the layer between apps and
services. Its core does one job: compose screens and run actions, safely, in parallel, with
negotiation and failure isolation. Everything around that job (who the viewer is, where data comes
from, what gets cached and where, how it's traced) arrives through extension points, as packages
you choose.

### Declarative first

What a screen *is* should read as data. You should see its islands, their order and their rules
without reading control flow. Code goes in the parts that are genuinely code: resolving props,
performing actions, and deciding whether an island shows.

```ts
// TypeScript
const profile = screen("profile", {
  requires: signedIn,
  meta: ({ params, load }) => profileMeta(params.userId, load),
  islands: [
    place("header", ProfileHeader, { required: true }),
    place("follow", FollowButton, { when: ({ ctx }) => ctx.viewer.id !== ctx.params.userId }),
    place("posts", [PostGridV1, PostGridV2], { timeoutMs: 300 }),
  ],
  cache: { maxAge: 30 },
});

const composer = createComposer({
  screens: [profile],
  actions: [followUser],
  context: async (request) => ({ viewer: await sessions.viewer(request) }),
  use: [tracing(), islandCache({ store: redisStore(redis) }), reportErrors(sentry)],
});

export default { fetch: composer.fetch }; // Bun, Deno, Workers, Hono, Next.js route handlers
```

```go
// Go
profile := cc.Screen{
	ID:       "profile",
	Requires: cc.SignedIn,
	Meta:     profileMeta,
	Islands: []cc.Placement{
		{Key: "header", Versions: cc.Versions(header), Required: true},
		{Key: "follow", Versions: cc.Versions(followButton), When: notOwnProfile},
		{Key: "posts", Versions: cc.Versions(postGridV1, postGridV2), Timeout: 300 * time.Millisecond},
	},
	Cache: cc.MaxAge(30 * time.Second),
}

composer := cc.New(cc.Config{
	Screens: []cc.Screen{profile},
	Actions: []cc.Action{followUser},
	Context: sessions.Viewer, // func(*http.Request) (context.Context, error)
	Use:     []cc.Plugin{otelcc.Tracing(), cachecc.Islands(rediscc.Store(rdb)), sentrycc.Errors()},
})

http.Handle("/compose/", composer) // a Composer is an http.Handler
```

Islands and actions are declared once, by their generated types, and then placed by name:

```ts
const ProfileHeader = island(ProfileHeaderV2, async ({ params, load }) => {
  const user = await load(`user:${params.userId}`, () => users.get(params.userId));
  return { displayName: user.name, avatarUrl: user.avatar };
});
```

### Extension points

| Point | Runs | Used for |
| --- | --- | --- |
| **Context** | once per request, before anything else | the viewer from a session, a JWT or an API key; locale; tenant |
| **Requirements** | before a screen's layout or an action's handler | signed in, roles, feature flags, as reusable values (`signedIn`, `role("admin")`) |
| **Screen** | around composing a whole screen | tracing, metrics, whole-response caching for anonymous screens |
| **Island** | around resolving one island version | caching an island's props, tracing, per-island metrics |
| **Action** | around performing an action | idempotency stores, rate limits, audit logs, tracing |
| **Loaders** | inside a request, through `load` and batch loaders | data sources that plug in as batch loaders (SQL, HTTP clients, GraphQL) |
| **Errors** | whenever an island, layout, meta or action fails | Sentry, logs |

A plugin is a value that implements some of these. The core calls them in the order they're listed
in `use`, and conformance runs with them installed, so a plugin can't break the protocol. A plugin
is also the right way for an app to share its own conventions across screens, as Flavr's gateway
`kit` does today.

### Integrations

The core depends on nothing but the standard library. Integrations are separate packages (npm) and
modules (Go), so an app only pulls in what it uses. The first set:

| Integration | What it gives you | Go | TypeScript |
| --- | --- | --- | --- |
| **Auth** | context from a bearer token, session cookie or JWT; `signedIn` and role requirements | `auth` | `@client-compose/auth` |
| **Island cache** | cache an island's props across requests, by a key the island declares; memory and Redis stores | `cache`, `redis` | `@client-compose/cache`, `@client-compose/redis` |
| **Idempotency** | actions with an idempotency key return their first outcome on retry; memory and Redis stores | `idempotency`, `redis` | `@client-compose/idempotency`, `@client-compose/redis` |
| **Tracing** | OpenTelemetry spans for screens, islands, loads and actions | `otel` | `@client-compose/otel` |

A note on caching. The protocol says caching across requests belongs in the services a composer
calls, because only they know what a result depends on (§9). The island cache doesn't change that
rule: it's opt-in per island, and the island declares its key. A personalised island has to put the
viewer in its key, and an island with no key isn't cached. It exists because many apps have no
service layer of their own: the composer *is* their backend.

Anyone can write an integration against the extension points. First-party ones live in this repo,
pass conformance with themselves installed, and follow the same versioning as the cores.

## Client core

| Id | Capability | Spec |
| --- | --- | --- |
| CLI-1 | **Registry.** Register a renderer by generated props type; capabilities are derived from what's registered. | §3 |
| CLI-2 | **Transport.** Base URL, client context, and headers that can be computed per request (async), e.g. a fresh token. Swappable for tests or a proxy. | §3 |
| CLI-3 | **Planning.** Turn a response into renderable islands in order, skipping (and reporting) unknown islands, unknown statuses and props that don't decode. Error fallback optional. | §4.4 |
| CLI-4 | **Screen errors as types.** Not found, unauthenticated, forbidden and other failures are distinguishable without parsing bodies. | §4.3 |
| CLI-5 | **Actions.** Call an action by its generated descriptor. The outcome is the typed result, one of the declared errors, or a failure, never an exception for an expected outcome. Idempotency key per intent, reused on retry. | §5 |
| CLI-6 | **Effects.** Apply `invalidate` (drop cached screens whose reference matches, and tell whoever shows them) and pass `navigate` to the app. | §5.3 |
| CLI-7 | **Cache.** Reuse responses for the composer's `cache.maxAge`, keyed by screen and params; invalidation drops them. | §4 |
| CLI-8 | **Test kit.** A fake composer answering screens and actions with typed builders, recording requests and effects. | — |
| CLI-9 | **Conformance.** Passes the client fixtures, rendering and actions. | §8.2 |

## UI binding

| Id | Capability |
| --- | --- |
| UI-1 | **Composed screen.** One view/component that fetches a screen and renders its islands in order, with loading, error (with retry) and not-found slots, and full control over the container. |
| UI-2 | **Screen state.** The platform's state holder (a hook, an observable model, a `StateFlow`) with loading, ready, failed, refreshing and reload, for custom layouts and pull-to-refresh. A failed reload keeps what's shown. |
| UI-3 | **Action state.** The platform's way to run an action from an island and show its pending state and last outcome. |
| UI-4 | **Invalidation.** Screens on show reload when an action invalidates them, without app code. |
| UI-5 | **Navigation hook.** `navigate` effects reach one app-provided function that maps screens to routes. |
| UI-6 | **Crash isolation.** An island that crashes while rendering hides itself and is reported; the screen stays up. |
| UI-7 | **Meta.** The screen's meta is available to the app (page title, navigation title). |
| UI-8 | **Cancellation.** Leaving a screen or changing its params cancels its request. |
| UI-9 | **Testing.** Render islands and screens in tests against the fake composer, in the platform's usual test tools. |

Some rows are one platform's business: server rendering and React Server Components, and the
proxy that keeps a session in an httpOnly cookie, are web-only.

## Tooling

| Id | Capability |
| --- | --- |
| TL-1 | **Codegen, props.** Manifests to props types for every client and composer language, with descriptors tying each type to its island type and version. |
| TL-2 | **Codegen, actions.** Input, result, error and descriptor types for every language. |
| TL-3 | **Compatibility lint.** Flags a change to a released version that breaks either side. |
| TL-4 | **Standalone binaries.** Codegen without Node. |
| TL-5 | **Conformance runner.** Runs the composer suite against any URL; client fixtures are plain JSON any language can load. |

## Ergonomics

What makes these feel like one toolkit rather than six libraries:

1. **No strings in app code.** Islands and actions are always registered and called by their
   generated type. The island type, version and action name appear once, in the manifest.
2. **The same nouns everywhere.** Screen, placement, island, action, effects, screen reference,
   load, batch loader, registry, composed screen. A Go developer and a Swift developer can read
   each other's code.
3. **Each language's own shape.** Go takes a `context.Context` and functional options. TypeScript
   takes objects. Swift uses `async`/`await` and `@Observable`. Kotlin uses `suspend` functions and
   `StateFlow`. The nouns are shared; the grammar is native.
4. **Expected outcomes are values, faults are errors.** A declared action error or an errored
   island is something to handle, so it's in the return type. A dropped connection is a failure.
5. **Testable without a server.** Both sides ship a test kit, so an island or a screen can be
   tested the way the app uses it, in the platform's usual test tools.
6. **Small dependencies.** A core needs the standard library and its usual JSON library. Bindings
   add only their UI framework.

### Names across stacks

| Concept | Go | TypeScript composer | TypeScript client / React | Swift / SwiftUI | Kotlin / Compose |
| --- | --- | --- | --- | --- | --- |
| Composer | *`cc.New(cc.Config{Screens, Actions, Context, Use})`* | *`createComposer({ screens, actions, context, use })`* | | | |
| Screen | *`cc.Screen{ID, Islands, Requires, Meta}`* | *`screen(id, { islands, requires, meta })`* | | | |
| Placement | `cc.Placement{Key, Versions, Required, When}` | *`place(key, Island, { required, when })`* | | | |
| Plugin | *`cc.Plugin`* | *`Plugin`* | | | |
| Island version | `cc.Define(fn)` | *`island(Props, fn)`* | | | |
| Action version | `cc.DefineAction(fn)` | *`action(Action, fn)`* | | | |
| Shared load | `cc.Load(ctx, key, fn)` | `rc.load(key, fn)` | | | |
| Client | | | `ClientComposeConfig` | *`ComposeClient`* | *`ComposeClient`* |
| Register | | | `registry.registerComponent(Props, C)` | `registry.register(Props.self) { … }` | `registry.register(Props) { … }` |
| Screen view | | | `<ComposedScreen>` | `ComposedScreen` | *`ComposedScreen()`* |
| Screen state | | | `useScreen` | *`ScreenModel`* | *`ScreenState`* (`StateFlow`) |
| Action | | | `useAction(Action)` | *`client.perform(Action.self, input)`* | *`client.perform(Action, input)`* |
| Test kit | *`cctest`* | *`@client-compose/composer/testing`* | `@client-compose/react/testing` | *`ClientComposeTesting`* | *`client-compose-testing`* |

Names in *italics* don't exist yet; the parity work below adds them.

## Where each stack stands

✅ done · ◐ partly · ✗ missing · — doesn't apply. As of 2026-10-22.

### Composers

| | Go | TypeScript |
| --- | --- | --- |
| CMP-1 declarative screens | ◐ layout functions only | ◐ layout functions only |
| CMP-2 to CMP-9 | ✅ | ✅ |
| CMP-10 one composer | ✅ | ◐ screens and actions are separate (`createComposer`, `createActions`) |
| CMP-11 error reporting | ◐ options, not plugins | ◐ options, not plugins |
| CMP-12 adapters | ✅ `net/http` (any router via `ComposeHTTP`) | ◐ `node:http` only: fetch-standard, Express and Fastify to add |
| CMP-13 in-process testing | ◐ `Compose` and `Perform` exist, no helpers | ✗ |
| CMP-14 conformance | ✅ | ✅ |
| CMP-15 app context | ◐ your own `net/http` middleware | ✗ |
| CMP-16 requirements | ✗ return `ErrUnauthenticated` by hand | ✗ throw by hand |
| CMP-17 plugins | ✗ | ✗ |
| Integrations | ✗ | ✗ |

### Clients

| | TypeScript / React | Swift / SwiftUI | Kotlin / Compose |
| --- | --- | --- | --- |
| CLI-1 registry | ✅ | ✅ | ✅ |
| CLI-2 transport | ✅ | ◐ fixed headers only | ✅ pluggable |
| CLI-3 planning | ✅ | ✅ | ✅ |
| CLI-4 screen errors | ✅ `ScreenFetchError.code` | ◐ status and body | ◐ status and body |
| CLI-5 actions | ✅ | ✗ | ✗ |
| CLI-6 effects | ✅ | ✗ | ✗ |
| CLI-7 cache | ✅ (in the binding) | ✗ | ✗ |
| CLI-8 test kit | ✅ | ✗ | ✗ |
| CLI-9 conformance | ◐ rendering only | ◐ rendering only | ◐ rendering only |
| UI-1 composed screen | ✅ | ◐ no not-found slot or container control | ✗ no Compose binding |
| UI-2 screen state | ✅ `useScreen` | ✗ | ✗ |
| UI-3 action state | ✅ `useAction` | ✗ | ✗ |
| UI-4 invalidation | ✅ | ✗ | ✗ |
| UI-5 navigation hook | ✅ | ✗ | ✗ |
| UI-6 crash isolation | ✅ error boundaries | ◐ decode failures only | ◐ decode failures only |
| UI-7 meta | ✅ | ✗ decoded, not exposed | ✗ |
| UI-8 cancellation | ✅ | ✅ `.task` | ✗ |
| UI-9 testing | ✅ | ✗ | ✗ |

Swift can't catch a crashing view the way React can, so UI-6 there means decode failures and
anything thrown while building an island's view.

### Tooling

| | Go | TypeScript | Swift | Kotlin |
| --- | --- | --- | --- | --- |
| TL-1 props | ✅ | ✅ | ✅ | ✅ |
| TL-2 actions | ✅ | ✅ | ✗ | ✗ |

TL-3 to TL-5 are language-neutral and done. The client fixtures (CLI-9) don't cover actions or
effects yet, for any client.

## The parity work

In order, each as its own pull request:

1. **This document.**
2. **Composers.** The declarative shape and the extension points in Go and TypeScript, as one
   breaking change at 0.x (CMP-1, CMP-10, CMP-11, CMP-15 to CMP-17). Fetch-standard, Express and
   Fastify adapters (CMP-12). Test kits for both (CMP-13). Candidates from Flavr, the first
   production app: a static placement (an island whose props are known up front) and loading many
   keys from a batch loader at once. Flavr moves to the new Go API in the same round.
3. **Integrations.** Auth, the island cache, idempotency, Redis stores and OpenTelemetry, in Go and
   TypeScript.
4. **Conformance.** Client fixtures for actions and effects: outcomes, declared and unknown error
   codes, reference matching for `invalidate` (CLI-9).
5. **Swift and SwiftUI.** CLI-2 and CLI-4 to CLI-8, UI-1 to UI-9, and TL-2.
6. **Kotlin and Jetpack Compose.** The same, with a new `compose` binding on the JVM core. Kotlin
   Multiplatform comes later.
7. **Publishing.** Swift through SwiftPM tags, Kotlin on Maven Central.

Not in this round: streaming and single-island refresh (protocol v1 candidates, §7 of the
protocol), and Kotlin Multiplatform.
