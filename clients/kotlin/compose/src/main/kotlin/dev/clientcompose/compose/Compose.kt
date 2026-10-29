package dev.clientcompose.compose

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import dev.clientcompose.ActionDescriptor
import dev.clientcompose.ActionResult
import dev.clientcompose.ActionState
import dev.clientcompose.ComposeClient
import dev.clientcompose.DeclaredError
import dev.clientcompose.IslandRegistry
import dev.clientcompose.PlannedIsland
import dev.clientcompose.ScreenMeta
import dev.clientcompose.ScreenState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/** What an island renders to in Compose. */
public typealias IslandContent = @Composable () -> Unit

/** The client `ComposedScreen` and `rememberAction` use. Set it with [ProvideCompose]. */
public val LocalComposeClient: androidx.compose.runtime.ProvidableCompositionLocal<ComposeClient?> =
    staticCompositionLocalOf { null }

/** The islands `ComposedScreen` can render. Set it with [ProvideCompose]. */
public val LocalIslandRegistry: androidx.compose.runtime.ProvidableCompositionLocal<IslandRegistry<IslandContent>> =
    staticCompositionLocalOf { IslandRegistry() }

/**
 * Gives every `ComposedScreen` and `rememberAction` below it the client and registry:
 *
 *     setContent {
 *         ProvideCompose(client, Islands.registry) { AppNavHost() }
 *     }
 */
@Composable
public fun ProvideCompose(client: ComposeClient, registry: IslandRegistry<IslandContent>, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalComposeClient provides client, LocalIslandRegistry provides registry, content = content)
}

/**
 * A screen's state for custom layouts (UI-2), loaded when it first composes and reloaded when an
 * action invalidates it. Collect [ScreenState.state] with `collectAsState()`.
 */
@Composable
public fun rememberScreenState(screen: String, params: Map<String, String> = emptyMap()): ScreenState<IslandContent> {
    val client = LocalComposeClient.current ?: error("rememberScreenState needs ProvideCompose above it")
    val registry = LocalIslandRegistry.current
    val parent = rememberCoroutineScope()
    // Each screen and params gets its own scope, cancelled when they change or the screen leaves.
    val (scope, state) = remember(client, registry, screen, params) {
        val scope = CoroutineScope(parent.coroutineContext + SupervisorJob(parent.coroutineContext[kotlinx.coroutines.Job]))
        scope to ScreenState(client, registry, screen, params, scope)
    }
    DisposableEffect(scope) { onDispose { scope.cancel() } }
    LaunchedEffect(state) { state.load() }
    return state
}

/**
 * Fetches a screen and shows its islands in order (UI-1), with the client and registry from
 * [ProvideCompose]:
 *
 *     ComposedScreen("profile", mapOf("userId" to userId), onMeta = { title = it?.title })
 *
 * Not found is a `ScreenException` with `isNotFound` in [failure]. It reloads when an action changes
 * it, and leaving it cancels its request.
 *
 * @param onMeta the screen's meta, e.g. for the top bar's title, whenever it changes.
 * @param content lays out the islands; by default a `LazyColumn`.
 */
@Composable
public fun ComposedScreen(
    screen: String,
    params: Map<String, String> = emptyMap(),
    modifier: Modifier = Modifier,
    onMeta: (ScreenMeta?) -> Unit = {},
    loading: @Composable () -> Unit = { DefaultLoading(modifier) },
    failure: @Composable (error: Throwable, retry: () -> Unit) -> Unit = { _, retry -> DefaultFailure(retry, modifier) },
    content: @Composable (islands: List<PlannedIsland<IslandContent>>) -> Unit = { DefaultIslands(it, modifier) },
) {
    val state = rememberScreenState(screen, params)
    val snapshot by state.state.collectAsState()
    LaunchedEffect(snapshot.meta) { onMeta(snapshot.meta) }
    when (snapshot.status) {
        ScreenState.Status.LOADING -> loading()
        ScreenState.Status.FAILED -> failure(snapshot.error ?: IllegalStateException("no response")) { state.reload() }
        ScreenState.Status.READY -> content(snapshot.islands)
    }
}

/** The islands top to bottom in a `LazyColumn`. */
@Composable
public fun DefaultIslands(islands: List<PlannedIsland<IslandContent>>, modifier: Modifier = Modifier) {
    LazyColumn(modifier) {
        items(islands, key = { it.key }) { it.output() }
    }
}

@Composable
private fun DefaultLoading(modifier: Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

@Composable
private fun DefaultFailure(retry: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        TextButton(onClick = retry) { Text("Try again") }
    }
}

/**
 * An action for a composable (UI-3), using the client from [ProvideCompose]:
 *
 *     val follow = rememberAction(FollowUserV1)
 *     Button(onClick = { follow.run(FollowUserV1.Input(userId, follow = true)) }, enabled = !follow.pending) { Text("Follow") }
 *     if (follow.last.declaredError == FollowUserV1.Error.Blocked) Text("You can't follow this person")
 *     if (follow.last.failed) Text("Something went wrong")
 */
@Composable
public fun <I, R, E : DeclaredError> rememberAction(action: ActionDescriptor<I, R, E>): ComposeAction<I, R, E> {
    val client = LocalComposeClient.current ?: error("rememberAction needs ProvideCompose above it")
    val scope = rememberCoroutineScope()
    val registry = LocalIslandRegistry.current
    val state = remember(client, action, registry) { ActionState(client, action, registry.catalog) }
    val inFlight by state.inFlight.collectAsState()
    val last by state.last.collectAsState()
    return ComposeAction(inFlight > 0, last, state, scope)
}

/** An action's state in a composable. Get one with [rememberAction]. */
@Stable
public class ComposeAction<I, R, E : DeclaredError> internal constructor(
    /** A call is in flight. */
    public val pending: Boolean,
    /** How the last call ended. */
    public val last: ActionResult<R, E>?,
    private val state: ActionState<I, R, E>,
    private val scope: CoroutineScope,
) {
    /** Runs the action in the composition's scope, e.g. from `onClick`. */
    public fun run(input: I) {
        scope.launch { state.run(input) }
    }

    /** Runs the action and waits for how it ended. It never throws (except to cancel). */
    public suspend fun runAndWait(input: I): ActionResult<R, E> = state.run(input)

    /** Forget the last result, e.g. when the form changes. */
    public fun reset(): Unit = state.reset()
}
