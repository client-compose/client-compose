# Swift client

Tier: **core** · Protocol: **v0** · iOS 15+, macOS 12+ · Dependencies: none

Add the repository URL as a Swift package (`Package.swift` is at the repo root) and link:

- `ClientCompose`: registry, request building, response planning, `ScreenClient`.
  Works with SwiftUI, UIKit or anything else.
- `ClientComposeSwiftUI`: optional `ComposedScreen` view that fetches and renders a screen.

```swift
// ProfileHeaderV2 is generated from the island manifest by codegen/.
let registry = IslandRegistry<AnyView>()
    .register(ProfileHeaderV2.self) { props, _ in AnyView(ProfileHeader(props: props)) }

ComposedScreen(
    screen: "profile",
    params: ["userId": userId],
    context: ClientContext(appVersion: appVersion),
    registry: registry,
    client: ScreenClient(baseURL: composerURL),
    loading: { ProgressView() },
    failure: { _, retry in Button("Retry", action: retry) }
)
```

For UIKit, use `IslandRegistry<UIView>` (or a view-controller factory), then call
`ScreenClient.fetch` and `registry.plan` yourself.

Props that fail to decode skip that island and are reported through `onSkipped`; they never
fail the whole screen.

See `examples/profile/ios` for a full example.

## Tests

```sh
swift test   # from the repo root; runs the shared client conformance fixtures
```
