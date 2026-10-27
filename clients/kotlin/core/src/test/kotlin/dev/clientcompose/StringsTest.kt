package dev.clientcompose

import dev.clientcompose.testing.FakeComposer
import dev.clientcompose.testing.FakeIsland
import dev.clientcompose.testing.FakeResponse
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Stand-ins for generated types.
@Serializable
data class RecipesV1(val total: Int) {
    companion object : IslandDescriptorWithStrings<RecipesV1, Strings> {
        override val type = "recipes"
        override val version = 1
        override val propsSerializer: KSerializer<RecipesV1> get() = serializer()
        override fun strings(table: StringsTable): Strings = Strings(table)
    }

    class Strings(private val table: StringsTable) {
        val heading: String get() = table.text("heading")
        fun count(count: Int): String = table.format("count", mapOf("count" to count.toString()))
    }
}

class TestAppStrings(private val table: StringsTable) {
    val retry: String get() = table.text("retry")
}

/** Strings (spec §4.7): plural rules and templates against the shared fixtures, islands' `t`, and the app strings. */
class StringsTest {
    @Serializable
    private data class Rules(val rules: Map<String, Map<String, String>>)

    @Serializable
    private data class PluralCases(val cases: Map<String, Map<String, List<Long>>>)

    @Serializable
    private data class StringCases(val cases: List<StringCase>)

    @Serializable
    private data class StringCase(
        val name: String,
        val language: String,
        val template: JsonElement,
        val values: Map<String, JsonPrimitive>,
        val expect: String,
    )

    private fun read(path: String) = File(File(System.getProperty("conformanceDir")).parentFile, path).readText()

    private val rules = ClientComposeJson.decodeFromString(Rules.serializer(), read("spec/plurals.json")).rules

    @Test
    fun pluralCategoriesAgreeWithCLDR() {
        val cases = ClientComposeJson.decodeFromString(PluralCases.serializer(), read("conformance/client/plural-cases.json")).cases
        assertTrue(cases.size > 200)
        for ((language, categories) in cases) {
            for ((category, counts) in categories) {
                for (count in counts) {
                    assertEquals(category, Plurals.category(rules[language] ?: emptyMap(), count), "$language $count")
                }
            }
        }
    }

    @Test
    fun templatesAreFilledInAsTheFixturesSay() {
        for (c in ClientComposeJson.decodeFromString(StringCases.serializer(), read("conformance/client/string-cases.json")).cases) {
            val values = c.values.mapValues { it.value.content }
            assertEquals(c.expect, formatString(c.template, values, rules[c.language] ?: emptyMap()), c.name)
        }
    }

    private val polish = mapOf(
        "one" to "i = 1 and v = 0",
        "few" to "v = 0 and i % 10 = 2..4 and i % 100 != 12..14",
        "many" to "v = 0 and i != 1 and i % 10 = 0..1 or v = 0 and i % 10 = 5..9 or v = 0 and i % 100 = 12..14",
    )

    @Test
    fun anIslandGetsItsStringsAsT() = runTest {
        val words = mapOf(
            "heading" to JsonPrimitive("Przepisy"),
            "count" to buildJsonObject {
                put("#1", "{count} przepis")
                put("#few", "{count} przepisy")
                put("#*", "{count} przepisów")
            },
        )
        val composer = FakeComposer().screen("home") {
            FakeResponse.screen("home", listOf(FakeIsland.island("recipes", RecipesV1, RecipesV1(total = 22), strings = words)), locale = "pl", plurals = polish)
        }
        val registry = IslandRegistry<String>().register(RecipesV1) { props, t, _ -> "${t.heading}: ${t.count(props.total)}" }
        val client = ComposeClient(composer, ClientContext(appVersion = "1", locale = "pl"))
        val response = client.screen("home", islands = registry.capabilities)
        assertEquals("pl", response.locale)
        assertEquals(listOf("Przepisy: 22 przepisy"), registry.plan(response).map { it.output })
    }

    @Test
    fun fetchesTheAppStrings() = runTest {
        val composer = FakeComposer().strings { request ->
            FakeResponse.strings(request.locale ?: "en", mapOf("retry" to JsonPrimitive("Spróbuj ponownie")))
        }
        val client = ComposeClient(composer, ClientContext(appVersion = "1", locale = "pl-PL"))
        val words = client.strings()
        assertEquals("pl-PL", words.locale)
        assertEquals("Spróbuj ponownie", words.app(::TestAppStrings).retry)
        assertEquals(listOf("pl-PL"), composer.stringsRequests.map { it.locale })
    }

    @Test
    fun aFailedStringsRequestThrows() = runTest {
        val composer = FakeComposer().strings { FakeResponse.failure(404, "no_strings") }
        val client = ComposeClient(composer, ClientContext(appVersion = "1"))
        val error = assertFailsWith<ScreenException> { client.strings() }
        assertEquals("no_strings", error.code)
    }
}
