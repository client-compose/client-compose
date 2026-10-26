package dev.clientcompose

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Runs the shared client conformance fixtures (spec §8.2). */
class ConformanceTest {
    @Serializable
    private data class Fixture(val cases: List<Case>)

    @Serializable
    private data class Case(
        val name: String,
        val registered: Map<String, List<Int>>,
        val expectCapabilities: Map<String, List<Int>>,
        val renderErrors: Boolean = false,
        /** The lines of a screen's stream (spec §4.6). */
        val stream: List<JsonObject>,
        val expectRendered: List<String>,
        val expectSkipped: List<String>,
    )

    @Serializable
    private data class TestProps(val v: Int)

    @Test
    fun clientConformanceCases() {
        val file = File(System.getProperty("conformanceDir"), "client/cases.json")
        val fixture = ClientComposeJson.decodeFromString(Fixture.serializer(), file.readText())
        assertTrue(fixture.cases.isNotEmpty())

        for (c in fixture.cases) {
            val registry = IslandRegistry<String>()
            for ((type, versions) in c.registered) {
                for (version in versions) {
                    registry.register<TestProps>(type, version) { props, _ -> "$type@$version:${props.v}" }
                }
            }
            assertEquals(c.expectCapabilities, registry.capabilities, c.name)

            val response = ScreenStream.read(c.stream.joinToString("\n") { it.toString() })
            val skipped = mutableListOf<String>()
            val planned = registry.plan(
                response,
                onError = if (c.renderErrors) { entry, error -> "error:${entry.key}:${error.code}" } else null,
                onSkipped = { entry, _ -> skipped += entry.key },
            )
            assertEquals(c.expectRendered, planned.map { it.output }, c.name)
            assertEquals(c.expectSkipped, skipped, c.name)
        }
    }

    @Test
    fun decodesScreenMeta() {
        val response = ClientComposeJson.decodeFromString(
            ScreenResponse.serializer(),
            """{"protocol":0,"screen":"s","islands":[],"meta":{"title":"Ada","future":1}}""",
        )
        assertEquals(ScreenMeta(title = "Ada"), response.meta)
        val withoutMeta = ClientComposeJson.decodeFromString(ScreenResponse.serializer(), """{"protocol":0,"screen":"s","islands":[]}""")
        assertEquals(null, withoutMeta.meta)
    }

    @Test
    fun clientContextEncodesExtraFieldsFlat() {
        val json = ClientContext(appVersion = "4.2.0", extra = mapOf("osVersion" to "15")).toJson()
        assertEquals(
            mapOf("platform" to "android", "appVersion" to "4.2.0", "osVersion" to "15"),
            json.mapValues { it.value.jsonPrimitive.content },
        )
    }
}
