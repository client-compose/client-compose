package dev.clientcompose.testing

import dev.clientcompose.ActionDescriptor
import dev.clientcompose.ClientComposeJson
import dev.clientcompose.DeclaredError
import dev.clientcompose.IslandDescriptor
import dev.clientcompose.PROTOCOL_VERSION
import dev.clientcompose.ScreenRef
import dev.clientcompose.Transport
import dev.clientcompose.TransportResponse
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * A composer for tests (CLI-8): a [Transport] that answers screens and actions with responses you
 * build from your generated types, and records what the app sent.
 *
 *     val composer = FakeComposer()
 *         .screen("profile") { FakeResponse.screen("profile", listOf(FakeIsland.island("header", ProfileHeaderV2, ProfileHeaderV2(displayName = "Ada")))) }
 *         .action(FollowUserV1) { input -> FakeResponse.ok(FollowUserV1, FollowUserV1.Result(followers = 8), invalidate = listOf(ScreenRef("profile"))) }
 *     val client = ComposeClient(composer, ClientContext(appVersion = "1"))
 *
 * A request with no handler throws [Unhandled], which fails the test.
 */
public class FakeComposer : Transport {
    public class Unhandled(path: String) : IllegalStateException("FakeComposer has no handler for $path")

    /** A screen request the app sent. */
    public data class ScreenRequest(
        val screen: String,
        val params: Map<String, String>,
        /** The app's capabilities. */
        val islands: Map<String, List<Int>>,
        val headers: Map<String, String>,
    )

    /** An action request the app sent. */
    public data class ActionRequest(
        val action: String,
        val version: Int,
        val input: JsonElement,
        val idempotencyKey: String?,
        val headers: Map<String, String>,
    ) {
        /** The input, decoded with [serializer], e.g. `FollowUserV1.inputSerializer`. */
        public fun <I> input(serializer: KSerializer<I>): I = ClientComposeJson.decodeFromJsonElement(serializer, input)
    }

    private val screens = mutableMapOf<String, (ScreenRequest) -> FakeResponse>()
    private val actions = mutableMapOf<String, (ActionRequest) -> FakeResponse>()
    private val recordedScreens = mutableListOf<ScreenRequest>()
    private val recordedActions = mutableListOf<ActionRequest>()

    /** Answer requests for a screen. */
    public fun screen(id: String, handler: (ScreenRequest) -> FakeResponse): FakeComposer = apply {
        synchronized(this) { screens[id] = handler }
    }

    /** Answer an action, given its decoded input. */
    public fun <I, R, E : DeclaredError> action(action: ActionDescriptor<I, R, E>, handler: (I) -> FakeResponse): FakeComposer = apply {
        synchronized(this) { actions["${action.action}@${action.version}"] = { request -> handler(request.input(action.inputSerializer)) } }
    }

    /** Screen requests, in the order the app sent them. */
    public val screenRequests: List<ScreenRequest> get() = synchronized(this) { recordedScreens.toList() }

    /** Action requests, in the order the app sent them. */
    public val actionRequests: List<ActionRequest> get() = synchronized(this) { recordedActions.toList() }

    override suspend fun post(path: String, body: String, headers: Map<String, String>): TransportResponse {
        val json = ClientComposeJson.parseToJsonElement(body).jsonObject
        val response = if (path.startsWith("screens/")) {
            val request = ScreenRequest(
                screen = json["screen"]?.jsonPrimitive?.contentOrNull ?: "",
                params = json["params"]?.let { ClientComposeJson.decodeFromJsonElement(stringMap, it) } ?: emptyMap(),
                islands = json["islands"]?.let { ClientComposeJson.decodeFromJsonElement(capabilities, it) } ?: emptyMap(),
                headers = headers,
            )
            val handler = synchronized(this) {
                recordedScreens += request
                screens[request.screen]
            } ?: throw Unhandled(path)
            handler(request)
        } else {
            val request = ActionRequest(
                action = json["action"]?.jsonPrimitive?.contentOrNull ?: "",
                version = json["version"]?.jsonPrimitive?.intOrNull ?: 0,
                input = json["input"] ?: JsonNull,
                idempotencyKey = json["idempotencyKey"]?.jsonPrimitive?.contentOrNull,
                headers = headers,
            )
            val handler = synchronized(this) {
                recordedActions += request
                actions["${request.action}@${request.version}"]
            } ?: throw Unhandled(path)
            handler(request)
        }
        response.stream?.let { lines -> return TransportResponse(response.status, lines.joinToString("") { "$it\n" }) }
        return TransportResponse(response.status, response.body.toString())
    }

    private companion object {
        val stringMap = MapSerializer(String.serializer(), String.serializer())
        val capabilities = MapSerializer(String.serializer(), ListSerializer(Int.serializer()))
    }
}

/** A response for [FakeComposer] to send, built from your generated types. */
public class FakeResponse(
    public val status: Int,
    public val body: JsonElement,
    /** A screen's stream (spec §4.6), as its lines, sent in place of [body]. */
    public val stream: List<JsonElement>? = null,
) {
    public companion object {
        /** A screen, all at once: its stream's head with every island, then its end (spec §4.6). */
        public fun screen(id: String, islands: List<FakeIsland>, title: String? = null, cacheMaxAge: Int? = null): FakeResponse {
            val head = buildJsonObject {
                put("kind", "head")
                put("protocol", PROTOCOL_VERSION)
                put("screen", id)
                put("islands", kotlinx.serialization.json.JsonArray(islands.map { it.json }))
                title?.let { put("meta", buildJsonObject { put("title", it) }) }
                cacheMaxAge?.let { put("cache", buildJsonObject { put("maxAge", it) }) }
            }
            return FakeResponse(200, kotlinx.serialization.json.JsonNull, listOf(head, buildJsonObject { put("kind", "end") }))
        }

        /** A failed screen or action request, e.g. `failure(404, "not_found")`. */
        public fun failure(status: Int, code: String): FakeResponse =
            FakeResponse(status, buildJsonObject {
                put("protocol", PROTOCOL_VERSION)
                put("error", buildJsonObject { put("code", code) })
            })

        /** An action's result, and the screens it changed. */
        public fun <R> ok(
            action: ActionDescriptor<*, R, *>,
            result: R,
            invalidate: List<ScreenRef> = emptyList(),
            navigate: ScreenRef? = null,
        ): FakeResponse = FakeResponse(200, buildJsonObject {
            outcome(action, "ok")
            put("result", ClientComposeJson.encodeToJsonElement(action.resultSerializer, result))
            if (invalidate.isNotEmpty() || navigate != null) {
                put("effects", buildJsonObject {
                    if (invalidate.isNotEmpty()) put("invalidate", ClientComposeJson.encodeToJsonElement(ListSerializer(ScreenRef.serializer()), invalidate))
                    navigate?.let { put("navigate", ClientComposeJson.encodeToJsonElement(ScreenRef.serializer(), it)) }
                })
            }
        })

        /** One of an action's declared errors. */
        public fun <E : DeclaredError> error(action: ActionDescriptor<*, *, E>, error: E): FakeResponse =
            FakeResponse(200, buildJsonObject {
                outcome(action, "error")
                put("error", buildJsonObject {
                    put("code", error.code)
                    action.encodeErrorDetails(error, ClientComposeJson)?.let { put("details", it) }
                })
            })

        private fun kotlinx.serialization.json.JsonObjectBuilder.outcome(action: ActionDescriptor<*, *, *>, status: String) {
            put("protocol", PROTOCOL_VERSION)
            put("action", action.action)
            put("version", action.version)
            put("status", status)
        }
    }
}

/** An island in [FakeResponse.screen]. */
public class FakeIsland private constructor(internal val json: JsonObject) {
    public companion object {
        /** An island with props, typed by its generated props type. */
        public fun <P> island(key: String, island: IslandDescriptor<P>, props: P): FakeIsland = FakeIsland(buildJsonObject {
            put("key", key)
            put("type", island.type)
            put("version", island.version)
            put("status", "ok")
            put("props", ClientComposeJson.encodeToJsonElement(island.propsSerializer, props))
        })

        /** An island that failed on the composer, e.g. `islandError("posts", PostGridV1, "timeout")`. */
        public fun islandError(key: String, island: IslandDescriptor<*>, code: String): FakeIsland = FakeIsland(buildJsonObject {
            put("key", key)
            put("type", island.type)
            put("version", island.version)
            put("status", "error")
            put("error", buildJsonObject { put("code", code) })
        })
    }
}
