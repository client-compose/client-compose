// Wire types for Client Compose protocol v0. See spec/PROTOCOL.md.
package dev.clientcompose

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

public const val PROTOCOL_VERSION: Int = 0

public data class ClientContext(
    val appVersion: String,
    val platform: String = "android",
    val locale: String? = null,
    /** Extra targeting fields (e.g. `osVersion`), sent alongside the known ones. */
    val extra: Map<String, String> = emptyMap(),
) {
    public fun toJson(): JsonObject = buildJsonObject {
        extra.forEach { (k, v) -> put(k, v) }
        put("platform", platform)
        put("appVersion", appVersion)
        locale?.let { put("locale", it) }
    }
}

@Serializable
public data class ScreenRequest(
    @SerialName("protocol") val protocolVersion: Int,
    val screen: String,
    val params: Map<String, String>,
    val client: JsonObject,
    /** Capabilities: island type -> supported versions. */
    val islands: Map<String, List<Int>>,
)

@Serializable
public data class IslandError(
    val code: String,
    val message: String? = null,
    val retryable: Boolean? = null,
)

@Serializable
public data class IslandEntry(
    val key: String,
    val type: String,
    val version: Int,
    /**
     * Kept as a string so future statuses decode (and are then skipped, spec §4.4). `pending` is an
     * island still on its way in a stream's head (spec §4.6).
     */
    val status: String,
    val props: JsonObject? = null,
    val error: IslandError? = null,
    /** The island's strings, in the screen's language (spec §4.7). */
    val strings: Map<String, JsonElement>? = null,
)

@Serializable
public data class CacheHint(val maxAge: Int)

/** Describes the screen as a whole: e.g. the toolbar title (spec §4). */
@Serializable
public data class ScreenMeta(
    val title: String? = null,
    val description: String? = null,
    /** Absolute URL. */
    val image: String? = null,
)

@Serializable
public data class ScreenResponse(
    @SerialName("protocol") val protocolVersion: Int,
    val screen: String,
    val islands: List<IslandEntry>,
    val meta: ScreenMeta? = null,
    val cache: CacheHint? = null,
    /** The language the composer answered in, when it has strings (spec §4.7). */
    val locale: String? = null,
    /** That language's plural rules, for the islands' counted strings. */
    val plurals: Map<String, String>? = null,
)

/** JSON configuration that ignores unknown fields, as the spec requires. */
public val ClientComposeJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/** Refers to screens: those with this id whose params include all of [params] (spec §5.3). */
@Serializable
public data class ScreenRef(
    val screen: String,
    val params: Map<String, String> = emptyMap(),
) {
    /** Whether this reference matches a screen with this id and params. */
    public fun matches(screen: String, params: Map<String, String>): Boolean =
        screen == this.screen && this.params.all { (key, value) -> params[key] == value }
}

/** What a successful action changed (spec §5.3). Unknown effects are ignored. */
@Serializable
public data class ActionEffects(
    /** Screens whose content may have changed: dropped from the cache, and reloaded where they're on show. */
    val invalidate: List<ScreenRef> = emptyList(),
    /** A screen to show next: passed to the client's `onNavigate`. */
    val navigate: ScreenRef? = null,
)

/** The protocol error code in a failed response's body, if it has one (spec §4.3). */
internal fun errorCode(body: String): String? = try {
    val error = ClientComposeJson.parseToJsonElement(body).jsonObject["error"]?.jsonObject
    error?.get("code")?.jsonPrimitive?.contentOrNull
} catch (e: IllegalArgumentException) {
    null // not JSON, or not an object
}
