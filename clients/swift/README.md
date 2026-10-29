# Swift client

Tier: **core** · Protocol: **v0** · iOS 15+, macOS 12+, tvOS 15+, watchOS 8+ · Dependencies: none

Add the repository as a Swift package (`Package.swift` is at the repo root) and link what you need:

| Library | What |
| --- | --- |
| `ClientCompose` | `ComposeClient` (screens, actions, effects, caching), the island registry. Works with SwiftUI, UIKit or anything else. |
| `ClientComposeSwiftUI` | `ComposedScreen`, `ScreenModel` and `@ComposeAction`. |
| `ClientComposeTesting` | `FakeComposer`, for tests. |

Island props and actions are generated from their manifests by
[codegen](../../codegen): `ProfileHeaderV2`, `FollowUserV1` and so on.

## Set up once

```swift
let client = ComposeClient(
    baseURL: URL(string: "https://api.example.com/compose")!,
    context: ClientContext(appVersion: appVersion, locale: Locale.current.identifier),
    headers: { ["Authorization": "Bearer \(try await session.token())"] }, // worked out per request
    onNavigate: { ref in router.show(ref) }                                // actions' navigate effects
)

let registry = IslandRegistry<AnyView>()
    .register(ProfileHeaderV2.self) { props, _ in AnyView(ProfileHeader(props: props)) }
    .register(FollowButtonV1.self) { props, _ in AnyView(FollowButton(props: props)) }

@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup { RootView().compose(client: client, registry: registry) }
    }
}
```

## Show a screen

```swift
ComposedScreen("profile", params: ["userId": userId])
```

That fetches the screen and shows its islands top to bottom, with a spinner while it loads and a
retry button if it fails. The screen's title from the composer becomes the navigation title. It
reloads by itself when an action changes it, and leaving it cancels its request. To choose the
layout, loading and failure views:

```swift
ComposedScreen("profile", params: ["userId": userId]) { islands in
    List(islands) { $0.output }
} loading: {
    ProgressView()
} failure: { error, retry in
    if (error as? ScreenError)?.isNotFound == true {
        Text("This profile doesn't exist")
    } else {
        Button("Try again", action: retry)
    }
}
```

For full control (pull to refresh, your own empty state), use `ScreenModel` directly: it has
`islands`, `response`, `meta`, `error`, `refreshing`, `status`, `load()` and `reload()`.

## Run an action

```swift
struct FollowButton: View {
    let props: FollowButtonV1
    @ComposeAction(FollowUserV1.self) private var follow

    var body: some View {
        Button(props.isFollowing ? "Following" : "Follow") {
            Task { await follow.run(.init(userId: props.userId, follow: !props.isFollowing)) }
        }
        .disabled(follow.pending)

        if follow.last?.declaredError == .blocked { Text("You can't follow this person") }
        if follow.last?.failed == true { Text("Something went wrong") }
    }
}
```

`run` never throws: it ends in `.ok(result, effects)`, `.error(declared)` or `.failed(error)`.
When it succeeds, its effects are applied first. Screens it invalidates are dropped from the cache
and reloaded where they're on show, and `navigate` goes to your `onNavigate`.

Outside SwiftUI, call the client directly. Declared errors are values, and anything else throws
`ActionFailure`, including an error code this app version doesn't know (spec §5.1):

```swift
switch try await client.perform(RenameThingV1.self, .init(thingId: id, name: name)) {
case .ok(let result, _): show(result.thing)
case .error(.nameTaken(let details)): suggest(details.suggestions)
case .error(.locked): showLocked()
}
```

## Strings

Every word comes from the composer (spec §4.7). Register an island whose manifest declares strings,
and its renderer gets them as `t`, in the screen's language:

```swift
registry.register(RecipeListV1.self) { props, t, _ in
    AnyView(Text("\(t.heading): \(t.recipeCount(count: props.total))"))
}
```

Fetch the app strings when the app starts, and keep them for the next launch:

```swift
let response = try await client.strings()
let t = response.app(AppStrings.self) // t.retry
```

`StringsResponse` is `Codable`, so it can be written to disk as it is. In tests,
`FakeComposer().strings { client in .strings("en", ["retry": .text("Try again")]) }`.

## UIKit

Use an `IslandRegistry<UIView>` (or a view controller factory), fetch with
`client.screen(_:params:islands:)` and lay out `registry.plan(response)` yourself. Call
`client.watch(screen:params:)` to hear when an action invalidates the screen.

## Testing

`FakeComposer` answers screens and actions with responses built from your generated types, and
records what the app sent:

```swift
import ClientComposeTesting

let composer = FakeComposer()
    .screen("profile") { _ in .screen("profile", [.island("header", ProfileHeaderV2(displayName: "Ada", avatarUrl: url))]) }
    .action(FollowUserV1.self) { input in .ok(FollowUserV1.self, .init(followers: 8), invalidate: [ScreenRef(screen: "profile")]) }
let client = ComposeClient(transport: composer, context: ClientContext(appVersion: "1"))

// …run your view model or view, then:
XCTAssertEqual(try composer.actionRequests[0].input(as: FollowUserV1.Input.self).userId, "u1")
```

Also: `.failure(401, "unauthenticated")`, `.error(FollowUserV1.self, .blocked)`, and
`.islandError("posts", PostGridV1.self, code: "timeout")`. A request with no handler fails the test.

## Behaviour

- Islands whose props don't decode are skipped and reported through `onSkipped`; they never fail
  the screen. SwiftUI can't catch a view that crashes while rendering, so keep island views simple.
- Responses are kept for the composer's `cache.maxAge`, per client, keyed by screen and params.
  `reload()` always fetches. Pass `cache: false` to `ComposeClient` to turn it off.
- Every type is safe to use from Swift 6's strict concurrency checking.

The [todo example](../../examples/todo) has a composer in Go and TypeScript for a SwiftUI app to
use; a SwiftUI todo client is a welcome contribution.

## Tests

```sh
swift test   # from the repo root: the shared client fixtures, the client, and the SwiftUI models
```
