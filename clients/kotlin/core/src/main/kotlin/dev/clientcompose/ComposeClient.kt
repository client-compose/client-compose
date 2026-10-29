package dev.clientcompose

import java.net.URLEncoder
import java.util.UUID
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Talks to a composer: fetches screens and performs actions, applies what actions changed
 * (spec §5.3), and keeps screens for their `cache.maxAge`.
 *
 *     val client = ComposeClient(
 *         transport = HttpUrlConnectionTransport("https://api.example.com/compose"),
 *         context = ClientContext(appVersion = BuildConfig.VERSION_NAME),
 *         headers = { mapOf("Authorization" to "Bearer ${session.token()}") },
 *         onNavigate = { ref -> navController.navigate(ref.screen) },
 *     )
 *
 * Use one client for the app. Compose apps provide it with `ProvideCompose`.
 *
 * @param headers headers for every request, worked out each time, e.g. a fresh token.
 * @param cache keep screens for their `cache.maxAge`.
 * @param onNavigate called with an action's `navigate` effect. Map the screen to a route.
 */
public class ComposeClient(
    private val transport: Transport,
    public val context: ClientContext,
    private val headers: suspend () -> Map<String, String> = { emptyMap() },
    private val cache: Boolean = true,
    private val onNavigate: ((ScreenRef) -> Unit)? = null,
) {
    private class Entry(val screen: String, val params: Map<String, String>, val response: ScreenResponse, val expires: Long)

    private val mutex = Mutex()
    private val entries = mutableMapOf<String, Entry>()
    private val invalidated = MutableSharedFlow<List<ScreenRef>>(extraBufferCapacity = 16)

    /** Screens actions have invalidated. Screen states collect it to reload. */
    public val invalidations: SharedFlow<List<ScreenRef>> = invalidated.asSharedFlow()

    private val changed = MutableSharedFlow<EffectsBatch>(extraBufferCapacity = 16)

    /** Actions' changes and updates. Screen states collect it to apply them to what they show. */
    public val changes: SharedFlow<EffectsBatch> = changed.asSharedFlow()

    // ---- Screens ----

    /**
     * The screen, from the cache while it's fresh unless [reload] is set. Throws [ScreenException]
     * when the composer answers with an error (`isNotFound`, `isUnauthenticated`, `isForbidden`).
     *
     * @param islands the app's capabilities, usually `registry.capabilities`.
     */
    public suspend fun screen(
        screen: String,
        params: Map<String, String> = emptyMap(),
        islands: Map<String, List<Int>>,
        reload: Boolean = false,
    ): ScreenResponse {
        val key = key(screen, params)
        if (!reload) {
            mutex.withLock { entries[key]?.takeIf { it.expires > System.currentTimeMillis() } }?.let { return it.response }
        }
        val request = ScreenRequest(PROTOCOL_VERSION, screen, params, context.toJson(), islands)
        val response = post("screens/${segment(screen)}", ClientComposeJson.encodeToString(ScreenRequest.serializer(), request))
        if (response.status !in 200..299) throw ScreenException(response.status, errorCode(response.body), response.body)
        // The screen streams (spec §4.6); it's read to its end and shown all at once.
        val decoded = ScreenStream.read(response.body)
        val maxAge = decoded.cache?.maxAge ?: 0
        if (cache && maxAge > 0) {
            mutex.withLock { entries[key] = Entry(screen, params, decoded, System.currentTimeMillis() + maxAge * 1000L) }
        }
        return decoded
    }

    // ---- Strings ----

    /**
     * The app strings in the client's language (spec §4.7). Fetch them when the app starts, and keep
     * them for the next launch. Throws [ScreenException] when the composer answers with an error.
     *
     *     val words = client.strings().app(::AppStrings)
     */
    public suspend fun strings(): StringsResponse {
        val request = buildJsonObject {
            put("protocol", PROTOCOL_VERSION)
            put("client", context.toJson())
        }
        val response = post("strings", request.toString())
        if (response.status !in 200..299) throw ScreenException(response.status, errorCode(response.body), response.body)
        return ClientComposeJson.decodeFromString(StringsResponse.serializer(), response.body)
    }

    // ---- Actions ----

    /**
     * Performs an action by its generated descriptor. Returns its result or one of its declared
     * errors; anything else throws [ActionFailure]. On success its effects are applied first:
     * invalidated screens are dropped from the cache and reloaded where they're on show, and
     * `navigate` goes to `onNavigate`.
     *
     *     when (val outcome = client.perform(RenameThingV1, RenameThingV1.Input(thingId = id, name = name))) {
     *         is ActionOutcome.Ok -> show(outcome.result.thing)
     *         is ActionOutcome.Error -> when (val error = outcome.error) {
     *             is RenameThingV1.Error.NameTaken -> suggest(error.details.suggestions)
     *             RenameThingV1.Error.Locked -> showLocked()
     *         }
     *     }
     *
     * @param islands the app's islands, usually `registry.catalog`: the composer resolves the
     * islands an action updates at their versions, and its changes reach the islands holding their
     * entities (spec §5.2, §5.3).
     * @param idempotencyKey one per user intent. Pass the same key again to retry it.
     */
    public suspend fun <I, R, E : DeclaredError> perform(
        action: ActionDescriptor<I, R, E>,
        input: I,
        islands: IslandCatalog = IslandCatalog.EMPTY,
        idempotencyKey: String = UUID.randomUUID().toString(),
    ): ActionOutcome<R, E> {
        val request = buildJsonObject {
            put("protocol", PROTOCOL_VERSION)
            put("action", action.action)
            put("version", action.version)
            put("input", ClientComposeJson.encodeToJsonElement(action.inputSerializer, input))
            put("client", context.toJson())
            put("islands", buildJsonObject { islands.capabilities.forEach { (type, versions) -> put(type, JsonArray(versions.map { JsonPrimitive(it) })) } })
            put("idempotencyKey", idempotencyKey)
        }
        val response = post("actions/${segment(action.action)}", request.toString())
        val outcome = outcome(action, response)
        if (outcome is ActionOutcome.Ok) apply(EffectsBatch(outcome.effects, islands))
        return outcome
    }

    /** Applies an action's effects in the spec's order: changes and updates, then invalidations, then navigation. */
    private suspend fun apply(batch: EffectsBatch) {
        val effects = batch.effects
        if (batch.touchesScreens) {
            mutex.withLock {
                for ((key, entry) in entries.toMap()) {
                    val response = batch.apply(entry.response, entry.params)
                    if (response == null) entries.remove(key) else entries[key] = Entry(entry.screen, entry.params, response, entry.expires)
                }
            }
            changed.emit(batch)
        }
        if (effects.invalidate.isNotEmpty()) {
            mutex.withLock { entries.values.removeAll { e -> effects.invalidate.any { it.matches(e.screen, e.params) } } }
            invalidated.emit(effects.invalidate)
        }
        effects.navigate?.let { onNavigate?.invoke(it) }
    }

    private suspend fun post(path: String, body: String): TransportResponse = transport.post(path, body, headers())

    private fun key(screen: String, params: Map<String, String>) =
        screen + "?" + params.toSortedMap().entries.joinToString("&") { "${it.key}=${it.value}" }

    public companion object {
        /** Reads an action response (spec §5.3, conformance/client/action-cases.json). */
        public fun <R, E : DeclaredError> outcome(action: ActionDescriptor<*, R, E>, response: TransportResponse): ActionOutcome<R, E> {
            val failure = { code: String? -> ActionFailure(response.status, code, response.body) }
            if (response.status !in 200..299) throw failure(errorCode(response.body))
            val body = try {
                ClientComposeJson.parseToJsonElement(response.body).jsonObject
            } catch (e: IllegalArgumentException) {
                throw failure(null) // not JSON, or not an object
            }
            return when (body["status"]?.jsonPrimitive?.contentOrNull) {
                "ok" -> {
                    val result = try {
                        ClientComposeJson.decodeFromJsonElement(action.resultSerializer, body["result"] ?: JsonObject(emptyMap()))
                    } catch (e: IllegalArgumentException) {
                        throw failure(null)
                    }
                    val effects = body["effects"]?.let { decodeOrNull { ClientComposeJson.decodeFromJsonElement(ActionEffects.serializer(), it) } }
                    ActionOutcome.Ok(result, effects ?: ActionEffects())
                }
                "error" -> {
                    val error = body["error"]?.let { decodeOrNull { it.jsonObject } }
                    val code = error?.get("code")?.let { decodeOrNull { it.jsonPrimitive.contentOrNull } } ?: throw failure(null)
                    if (code !in action.errorCodes) throw failure(code) // a code this app version doesn't know (spec §5.1)
                    val details: JsonElement? = error["details"]
                    ActionOutcome.Error(decodeOrNull { action.decodeError(code, details, ClientComposeJson) } ?: throw failure(code))
                }
                else -> throw failure(null)
            }
        }

        private inline fun <T> decodeOrNull(decode: () -> T): T? = try {
            decode()
        } catch (e: IllegalArgumentException) {
            null
        }

        private fun segment(name: String) = URLEncoder.encode(name, "UTF-8").replace("+", "%20")
    }
}
