package dev.clientcompose.golden

import dev.clientcompose.ClientComposeJson
import dev.clientcompose.IslandRegistry
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

/** Compiles the generated Kotlin and checks it decodes the shared sample. */
class GoldenTest {
    @Test
    fun kitchenSinkDecodes() {
        val sample = File(System.getProperty("codegenFixturesDir"), "kitchen-sink.sample.json").readText()
        val props = ClientComposeJson.decodeFromString(KitchenSinkV1.serializer(), sample)

        assertEquals(KitchenSinkV1.Size.EXTRA_LARGE, props.size)
        assertEquals("https://example.com/ada.png", props.author.avatarUrl)
        assertEquals(KitchenSinkV1.Author.Role.ADMIN, props.author.role)
        assertEquals("Two", props.items?.last()?.label)
        assertEquals(5_000_000_000L, props.bigNumber)
        assertEquals("x", props.`class`)
        assertEquals(mapOf("k" to "v"), props.metadata)
    }

    @Test
    fun registerUsesGeneratedTypeAndVersion() {
        val registry = IslandRegistry<String>()
            .register(KitchenSinkV1) { props, _ -> props.title }
            .register(DividerV1) { _, _ -> "divider" }
        assertEquals(mapOf("kitchen-sink" to listOf(1), "divider" to listOf(1)), registry.capabilities)
    }
}
