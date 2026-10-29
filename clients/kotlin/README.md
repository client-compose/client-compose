# Kotlin client

Tier: **core** · Protocol: **v0** · JVM 17 / Android (minSdk 24) · Kotlin 2.1+

| Module | What |
| --- | --- |
| `core` | `ComposeClient` (screens, actions, effects, caching), the island registry, and the `ScreenState` and `ActionState` state holders, built on `StateFlow`. Plain Kotlin/JVM: kotlinx.serialization and kotlinx.coroutines, nothing from Android. |
| `compose` | Jetpack Compose: `ProvideCompose`, `ComposedScreen`, `rememberScreenState` and `rememberAction`. |
| `testing` | `FakeComposer`, for tests. |

Island props and actions are generated from their manifests by
[codegen](../../codegen): `ProfileHeaderV2`, `FollowUserV1` and so on.

## Set up once

```kotlin
val client = ComposeClient(
    transport = HttpUrlConnectionTransport("https://api.example.com/compose"), // or OkHttp, Ktor: see Transport
    context = ClientContext(appVersion = BuildConfig.VERSION_NAME),
    headers = { mapOf("Authorization" to "Bearer ${session.token()}") },     // worked out per request
    onNavigate = { ref -> navController.navigate(ref.screen) },               // actions' navigate effects
)

val registry = IslandRegistry<IslandContent>()
    .register(ProfileHeaderV2) { props, _ -> { ProfileHeader(props) } }
    .register(FollowButtonV1) { props, _ -> { FollowButton(props) } }

setContent {
    ProvideCompose(client, registry) { AppNavHost() }
}
```

## Show a screen

```kotlin
ComposedScreen("profile", mapOf("userId" to userId))
```

That fetches the screen and shows its islands in a `LazyColumn`, with a spinner while it loads and a
retry button if it fails. It reloads by itself when an action changes it, and leaving it cancels its
request. To set the top bar's title, or choose the layout, loading and failure:

```kotlin
var title by remember { mutableStateOf("") }
ComposedScreen(
    "profile",
    mapOf("userId" to userId),
    onMeta = { title = it?.title.orEmpty() },
    failure = { error, retry ->
        if ((error as? ScreenException)?.isNotFound == true) Text("This profile doesn't exist")
        else Button(onClick = retry) { Text("Try again") }
    },
) { islands ->
    LazyColumn { items(islands, key = { it.key }) { it.output() } }
}
```

For full control (pull to refresh, your own empty state), use `rememberScreenState`, or a
`ScreenState` in your ViewModel with `viewModelScope`. Its `state` is a `StateFlow` of `islands`,
`response`, `meta`, `error`, `refreshing` and `status`. Call `load()` and `reload()` to fetch.

## Run an action

```kotlin
@Composable
fun FollowButton(props: FollowButtonV1) {
    val follow = rememberAction(FollowUserV1)
    Button(onClick = { follow.run(FollowUserV1.Input(userId = props.userId, follow = !props.isFollowing)) }, enabled = !follow.pending) {
        Text(if (props.isFollowing) "Following" else "Follow")
    }
    if (follow.last.declaredError == FollowUserV1.Error.Blocked) Text("You can't follow this person")
    if (follow.last.failed) Text("Something went wrong")
}
```

A call ends in `ActionResult.Ok`, `ActionResult.Error` (a declared error) or `ActionResult.Failed`,
and never throws. When it succeeds, its effects are applied first, in this order (spec §5.3):

- **Changes**: each entity it changed is changed in every island showing it (the generated
  descriptors' `entities`), in cached screens and the ones on show, without fetching anything. A
  deleted entity leaves the list holding it.
- **Updates**: each island's new entry is swapped into its screen; the rest of the screen stays.
- **Invalidations**: the screens are dropped from the cache and reloaded where they're on show. So is
  a screen a change or update can't be applied to.
- `navigate` goes to your `onNavigate`.

Every action sends the island versions the app can draw, from the registry `ProvideCompose` gives.

Outside Compose, call the client from a coroutine. Declared errors are values, and anything else
throws `ActionFailure`, including an error code this app version doesn't know (spec §5.1):

```kotlin
when (val outcome = client.perform(RenameThingV1, RenameThingV1.Input(thingId = id, name = name), registry.catalog)) {
    is ActionOutcome.Ok -> show(outcome.result.thing)
    is ActionOutcome.Error -> when (val error = outcome.error) {
        is RenameThingV1.Error.NameTaken -> suggest(error.details.suggestions)
        RenameThingV1.Error.Locked -> showLocked()
    }
}
```

## Strings

Every word comes from the composer (spec §4.7). Register an island whose manifest declares strings,
and its renderer gets them as `t`, in the screen's language:

```kotlin
registry.register(RecipeListV1) { props, t, _ -> { Text("${t.heading}: ${t.recipeCount(props.total)}") } }
```

Fetch the app strings when the app starts, and keep them for the next launch:

```kotlin
val response = client.strings()
val t = response.app(::AppStrings) // t.retry
```

`StringsResponse` is `@Serializable`, so it can be kept as it is. In tests,
`FakeComposer().strings { FakeResponse.strings("en", mapOf("retry" to JsonPrimitive("Try again"))) }`.

## Transport

`HttpUrlConnectionTransport` needs no dependencies. To use OkHttp (or Ktor), implement `Transport`
in a few lines; see `examples/profile/android`.

## Testing

`FakeComposer` answers screens and actions with responses built from your generated types, and
records what the app sent:

```kotlin
val composer = FakeComposer()
    .screen("profile") { FakeResponse.screen("profile", listOf(FakeIsland.island("header", ProfileHeaderV2, ProfileHeaderV2(displayName = "Ada", avatarUrl = url)))) }
    .action(FollowUserV1) { input -> FakeResponse.ok(FollowUserV1, FollowUserV1.Result(followers = 8), invalidate = listOf(ScreenRef("profile"))) }
val client = ComposeClient(composer, ClientContext(appVersion = "1"))

// …run your screen state, ViewModel or composable (e.g. with Robolectric), then:
assertEquals("u1", composer.actionRequests.single().input(FollowUserV1.inputSerializer).userId)
```

Also: `FakeResponse.failure(401, "unauthenticated")`, `FakeResponse.error(FollowUserV1, FollowUserV1.Error.Blocked)`
and `FakeIsland.islandError("posts", PostGridV1, "timeout")`. A request with no handler fails the test.

## Behaviour

- Islands whose props don't decode are skipped and reported through `onSkipped`; they never fail the
  screen.
- Responses are kept for the composer's `cache.maxAge`, per client, keyed by screen and params.
  `reload()` always fetches. Pass `cache = false` to turn it off.

See [`examples/profile/android`](../../examples/profile/android) for a full example.

**Planned:** Kotlin Multiplatform targets.

## Tests

```sh
./gradlew test   # the shared client fixtures, the client, the state holders, and the composables
                 # (Robolectric); needs JDK 17+ and the Android SDK
```
