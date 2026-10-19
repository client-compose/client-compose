# Kotlin client

Tier: **core** · Protocol: **v0** · JVM 17 / Android · Dependencies: kotlinx.serialization

`core` contains the registry, request building, response planning and `ScreenClient`. It's a
plain Kotlin/JVM library with no Android or Compose dependency, so `R` can be whatever your UI
renders. With Jetpack Compose that's usually `@Composable () -> Unit`:

```kotlin
typealias IslandContent = @Composable () -> Unit

// ProfileHeaderV2 is generated from the island manifest by codegen/.
val registry = IslandRegistry<IslandContent>()
    .register(ProfileHeaderV2) { props, _ -> { ProfileHeader(props) } }

val client = ScreenClient(OkHttpTransport(okHttp, baseUrl)) // any HTTP library via ScreenTransport
val response = client.fetch(registry.request("profile", ClientContext(appVersion = BuildConfig.VERSION_NAME)))
val islands = registry.plan(response)
// LazyColumn { items(islands, key = { it.key }) { it.output() } }
```

Props that fail to decode skip that island and are reported through `onSkipped`; they never
fail the whole screen.

See `examples/profile/android` for a full example, including an OkHttp transport and ViewModel.

**Planned:** a Compose binding module (`ComposedScreen` like the SwiftUI one) and
Kotlin Multiplatform targets.

## Tests

```sh
./gradlew test   # runs the shared client conformance fixtures; needs JDK 17+
```
