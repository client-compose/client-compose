// Wire types for Client Compose protocol v0. See spec/PROTOCOL.md.
package dev.clientcompose

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
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
    /** Kept as a string so future statuses decode (and are then skipped, spec §4.4). */
    val status: String,
    val props: JsonObject? = null,
    val error: IslandError? = null,
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
)

/** JSON configuration that ignores unknown fields, as the spec requires. */
public val ClientComposeJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}
