package dev.clientcompose

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.serializer

public sealed interface SkipReason {
    /** The client has no renderer for this island type/version. */
    public data object UnknownIsland : SkipReason

    /** The island has a status this client doesn't understand (e.g. a future `pending`). */
    public data object UnknownStatus : SkipReason

    /** The props didn't decode into the renderer's props type. */
    public data class InvalidProps(val cause: Throwable) : SkipReason
}

public data class PlannedIsland<R>(val key: String, val output: R)

/**
 * Implemented by the companion of generated props types (see codegen/), tying a Kotlin type to
 * its island type and version.
 */
public interface IslandDescriptor<P> {
    public val type: String
    public val version: Int
    public val propsSerializer: KSerializer<P>
}

/**
 * Maps island type + version to a renderer. `R` is whatever your UI layer renders,
 * e.g. `@Composable () -> Unit` for Jetpack Compose or a `View` factory.
 */
public class IslandRegistry<R>(private val json: Json = ClientComposeJson) {
    private val renderers = mutableMapOf<String, MutableMap<Int, (JsonObject, IslandEntry) -> R>>()

    public fun <P> register(
        type: String,
        version: Int,
        serializer: KSerializer<P>,
        render: (props: P, entry: IslandEntry) -> R,
    ): IslandRegistry<R> {
        renderers.getOrPut(type) { mutableMapOf() }[version] = { props, entry ->
            render(json.decodeFromJsonElement(serializer, props), entry)
        }
        return this
    }

    /**
     * Register a renderer for one version of an island.
     *
     *     registry.register<ProfileHeaderV2>("profile-header", 2) { props, _ -> { ProfileHeader(props) } }
     */
    public inline fun <reified P> register(
        type: String,
        version: Int,
        noinline render: (props: P, entry: IslandEntry) -> R,
    ): IslandRegistry<R> = register(type, version, serializer<P>(), render)

    /**
     * Register a renderer for a generated props type; its island type and version come from the
     * type's companion.
     *
     *     registry.register(ProfileHeaderV2) { props, _ -> { ProfileHeader(props) } }
     */
    public fun <P> register(
        island: IslandDescriptor<P>,
        render: (props: P, entry: IslandEntry) -> R,
    ): IslandRegistry<R> = register(island.type, island.version, island.propsSerializer, render)

    /** What this client can render, sent with every request (spec §3). */
    public val capabilities: Map<String, List<Int>>
        get() = renderers.mapValues { (_, versions) -> versions.keys.sorted() }

    public fun request(
        screen: String,
        client: ClientContext,
        params: Map<String, String> = emptyMap(),
    ): ScreenRequest = ScreenRequest(PROTOCOL_VERSION, screen, params, client.toJson(), capabilities)

    /**
     * Turn a response into an ordered list of rendered islands (spec §4.4).
     *
     * @param onError render a fallback for an errored island; return null (the default) to omit it.
     * @param onSkipped called for islands that can't be rendered. Useful for telemetry.
     */
    public fun plan(
        response: ScreenResponse,
        onError: ((IslandEntry, IslandError) -> R?)? = null,
        onSkipped: ((IslandEntry, SkipReason) -> Unit)? = null,
    ): List<PlannedIsland<R>> = buildList {
        for (entry in response.islands) {
            when (entry.status) {
                "error" -> {
                    val error = entry.error ?: IslandError("unknown")
                    onError?.invoke(entry, error)?.let { add(PlannedIsland(entry.key, it)) }
                }
                "ok" -> {
                    val render = renderers[entry.type]?.get(entry.version)
                    if (render == null) {
                        onSkipped?.invoke(entry, SkipReason.UnknownIsland)
                        continue
                    }
                    try {
                        add(PlannedIsland(entry.key, render(entry.props ?: JsonObject(emptyMap()), entry)))
                    } catch (e: IllegalArgumentException) {
                        // kotlinx.serialization's SerializationException extends IllegalArgumentException.
                        onSkipped?.invoke(entry, SkipReason.InvalidProps(e))
                    }
                }
                else -> onSkipped?.invoke(entry, SkipReason.UnknownStatus)
            }
        }
    }
}
