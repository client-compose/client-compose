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
  props. Runs actions and says what they changed. Never decides how anything looks.
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
| CMP-1 | **Screens.** Register screens by id. A layout returns placements, in order, from the request's params, client context and app context (auth, locale). | §3, §4 |
| CMP-2 | **Islands from generated types.** Define an island version by the generated props type alone; its type and version come from the type. | §2 |
| CMP-3 | **Negotiation.** Several versions per placement; the highest the client declared wins, and an island with no common version is left out. | §4.2 |
| CMP-4 | **Failure isolation.** Islands resolve in parallel, each with a timeout. A failing, panicking or slow island errors on its own. `required` placements fail the screen instead. | §4.3 |
| CMP-5 | **Screen outcomes.** A layout or resolver can say *not found*, *unauthenticated* or *forbidden* by returning or throwing the core's error, without touching HTTP. | §4.3 |
| CMP-6 | **Meta and cache.** Optional screen meta, resolved alongside the islands, never failing the screen; a cache hint per screen. | §4 |
| CMP-7 | **Request-scoped loading.** `load(key, work)` shared by the layout, islands and meta in one request, under the request's lifetime; a batch loader. | §9 |
| CMP-8 | **Actions.** Define an action version by its generated input, result and error types. Input is validated before the handler runs. Declared errors are values; anything else is a failure. | §5 |
| CMP-9 | **Effects and idempotency.** Handlers return effects (`invalidate`, `navigate`) and can read the client's idempotency key. | §5.3 |
| CMP-10 | **One composer.** Screens and actions are registered together and served by one handler. | — |
| CMP-11 | **Hooks.** Callbacks for island, layout, meta and action failures, so they reach logs and error tracking. | — |
| CMP-12 | **Adapters.** The language's standard HTTP server, plus the popular frameworks. An adapter is a few lines and passes conformance through that framework. | — |
| CMP-13 | **In-process testing.** Call a screen or action from a test without a server, with every island declared, and read the outcome as typed values. | — |
| CMP-14 | **Conformance server.** A test-only binary that passes the composer suite. | §8.1 |

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
| Composer | `cc.New(screens, cc.WithActions(…))` | *`createComposer({ screens, actions })`* | | | |
| Island version | `cc.Define(fn)` | `defineIsland(Props, fn)` | | | |
| Action version | `cc.DefineAction(fn)` | `defineAction(Action, fn)` | | | |
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
| CMP-1 to CMP-9 | ✅ | ✅ |
| CMP-10 one composer | ✅ | ◐ screens and actions are separate (`createComposer`, `createActions`) |
| CMP-11 hooks | ✅ | ✅ |
| CMP-12 adapters | ✅ `net/http` (any router via `ComposeHTTP`) | ◐ `node:http` only: fetch-standard, Express and Fastify to add |
| CMP-13 in-process testing | ◐ `Compose` and `Perform` exist, no helpers | ✗ |
| CMP-14 conformance | ✅ | ✅ |

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
2. **Composers.** One composer in TypeScript (CMP-10), matching Go's shape. Fetch-standard,
   Express and Fastify adapters (CMP-12). Test kits for both (CMP-13). Candidates from Flavr,
   the first production app: a static placement (an island whose props are known up front) and
   loading many keys from a batch loader at once.
3. **Conformance.** Client fixtures for actions and effects: outcomes, declared and unknown error
   codes, reference matching for `invalidate` (CLI-9).
4. **Swift and SwiftUI.** CLI-2 and CLI-4 to CLI-8, UI-1 to UI-9, and TL-2.
5. **Kotlin and Jetpack Compose.** The same, with a new `compose` binding on the JVM core. Kotlin
   Multiplatform comes later.
6. **Publishing.** Swift through SwiftPM tags, Kotlin on Maven Central.

Not in this round: streaming and single-island refresh (protocol v1 candidates, §7 of the
protocol), and Kotlin Multiplatform.
