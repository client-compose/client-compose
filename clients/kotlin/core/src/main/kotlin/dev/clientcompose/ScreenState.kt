package dev.clientcompose

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * A screen's state (UI-2): its islands, its response and meta, and whether it's loading, as a
 * [StateFlow]. Everything runs in [scope]: a ViewModel's `viewModelScope`, or the composition's
 * scope through `rememberScreenState`. It reloads by itself when an action invalidates its screen
 * (spec §5.3), until [scope] ends.
 *
 *     class ProfileViewModel(client: ComposeClient, userId: String) : ViewModel() {
 *         val profile = ScreenState(client, Islands.registry, "profile", mapOf("userId" to userId), viewModelScope)
 *             .also { it.load() }
 *     }
 */
public class ScreenState<R>(
    private val client: ComposeClient,
    private val registry: IslandRegistry<R>,
    public val screen: String,
    public val params: Map<String, String> = emptyMap(),
    private val scope: CoroutineScope,
    private val onSkipped: ((IslandEntry, SkipReason) -> Unit)? = null,
) {
    public enum class Status { LOADING, READY, FAILED }

    public data class Snapshot<R>(
        /** The islands to show, in order. */
        val islands: List<PlannedIsland<R>> = emptyList(),
        /** The last response, if there's been one. */
        val response: ScreenResponse? = null,
        /** The last request's error. With a response, a reload failed and the earlier islands are shown. */
        val error: Throwable? = null,
        /** A request is in flight. */
        val refreshing: Boolean = false,
    ) {
        /** Loading until the first response; failed only if there's nothing to show. */
        val status: Status
            get() = when {
                response != null -> Status.READY
                error != null -> Status.FAILED
                else -> Status.LOADING
            }

        /** The screen as a whole: e.g. its title. */
        val meta: ScreenMeta? get() = response?.meta
    }

    private val _state = MutableStateFlow(Snapshot<R>())
    public val state: StateFlow<Snapshot<R>> = _state.asStateFlow()
    private var request: Job? = null

    init {
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.invalidations.collect { refs -> if (refs.any { it.matches(screen, params) }) reload() }
        }
        scope.launch(start = CoroutineStart.UNDISPATCHED) {
            client.changes.collect { batch -> apply(batch) }
        }
    }

    /** Shows the screen as an action left it, or reloads it when the changes can't be shown on it. */
    private fun apply(batch: EffectsBatch) {
        val response = _state.value.response ?: return
        val changed = batch.apply(response, params)
        if (changed == null) {
            reload()
            return
        }
        _state.update { it.copy(islands = registry.plan(changed, onSkipped = onSkipped), response = changed) }
    }

    /** Fetch the screen, from the client's cache if it's fresh. */
    public fun load(): Job = fetch(reload = false)

    /** Fetch the screen again, bypassing the cache. The current islands stay until the new ones arrive. */
    public fun reload(): Job = fetch(reload = true)

    private fun fetch(reload: Boolean): Job {
        request?.cancel()
        _state.update { it.copy(refreshing = true) }
        return scope.launch {
            try {
                val response = client.screen(screen, params, registry.capabilities, reload)
                val islands = registry.plan(response, onSkipped = onSkipped)
                _state.value = Snapshot(islands, response, error = null, refreshing = false)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(error = e, refreshing = false) }
            }
        }.also { request = it }
    }
}
