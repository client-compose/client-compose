package dev.clientcompose

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Runs the shared client fixtures for actions and effects (spec §5, §8.2). */
class ActionConformanceTest {
    @Serializable
    private data class Suite(
        val requests: List<Request>,
        val outcomes: List<Outcome>,
        val screenRefs: List<Ref>,
        val screenErrors: List<ScreenErrorCase>,
    )

    @Serializable
    private data class Request(val name: String, val input: JsonElement, val idempotencyKey: String, val expectPath: String, val expectBody: JsonElement)

    @Serializable
    private data class Response(val status: Int, val body: JsonElement? = null, val rawBody: String? = null) {
        val text: String get() = rawBody ?: body.toString()
    }

    @Serializable
    private data class Outcome(val name: String, val response: Response, val expect: JsonElement)

    @Serializable
    private data class Ref(val name: String, val ref: ScreenRef, val screen: String, val params: Map<String, String>, val matches: Boolean)

    @Serializable
    private data class ScreenErrorCase(val name: String, val status: Int, val body: JsonElement? = null, val rawBody: String? = null, val expectCode: String? = null)

    private data class Declared(override val code: String, val details: JsonElement?) : DeclaredError

    /** The fixtures' action: rename-thing v2, declaring "taken" and "locked". */
    private object Fixture : ActionDescriptor<JsonElement, JsonElement, Declared> {
        override val action = "rename-thing"
        override val version = 2
        override val inputSerializer: KSerializer<JsonElement> = JsonElement.serializer()
        override val resultSerializer: KSerializer<JsonElement> = JsonElement.serializer()
        override val errorCodes = listOf("taken", "locked")
        override fun decodeError(code: String, details: JsonElement?, json: Json) = Declared(code, details)
        override fun encodeErrorDetails(error: Declared, json: Json) = error.details
    }

    private val context = ClientContext(appVersion = "0.0.0", platform = "conformance")

    private val suite: Suite by lazy {
        val file = File(System.getProperty("conformanceDir"), "client/action-cases.json")
        ClientComposeJson.decodeFromString(Suite.serializer(), file.readText())
    }

    @Test
    fun requests() = runTest {
        for (c in suite.requests) {
            var path = ""
            var sent = ""
            val client = ComposeClient(Transport { p, body, _ ->
                path = p
                sent = body
                TransportResponse(200, """{"protocol":0,"status":"ok","result":{}}""")
            }, context)
            client.perform(Fixture, c.input, c.idempotencyKey)
            assertEquals(c.expectPath, path, c.name)
            assertEquals(c.expectBody, ClientComposeJson.parseToJsonElement(sent), c.name)
        }
    }

    @Test
    fun outcomes() = runTest {
        for (c in suite.outcomes) {
            val client = ComposeClient({ _, _, _ -> TransportResponse(c.response.status, c.response.text) }, context)
            val outcome = try {
                when (val o = client.perform(Fixture, JsonObject(emptyMap()))) {
                    is ActionOutcome.Ok -> buildJsonObject {
                        put("outcome", "ok")
                        put("result", o.result)
                        put("effects", effects(o.effects))
                    }
                    is ActionOutcome.Error -> buildJsonObject {
                        put("outcome", "error")
                        put("code", o.error.code)
                        put("details", o.error.details ?: JsonNull)
                    }
                }
            } catch (failure: ActionFailure) {
                buildJsonObject {
                    put("outcome", "failed")
                    put("status", failure.status)
                    put("code", failure.code?.let(::JsonPrimitive) ?: JsonNull)
                }
            }
            assertEquals(c.expect, outcome, c.name)
        }
    }

    @Test
    fun screenRefs() {
        for (c in suite.screenRefs) assertEquals(c.matches, c.ref.matches(c.screen, c.params), c.name)
    }

    @Test
    fun screenErrors() = runTest {
        for (c in suite.screenErrors) {
            val client = ComposeClient({ _, _, _ -> TransportResponse(c.status, c.rawBody ?: c.body.toString()) }, context)
            val error = assertFailsWith<ScreenException>(c.name) { client.screen("s", islands = emptyMap()) }
            assertEquals(c.expectCode, error.code, c.name)
            assertEquals(c.status, error.status, c.name)
        }
    }

    /** Effects as the fixtures write them: only the ones present. */
    private fun effects(effects: ActionEffects) = buildJsonObject {
        if (effects.invalidate.isNotEmpty()) put("invalidate", ClientComposeJson.encodeToJsonElement(ListSerializer(ScreenRef.serializer()), effects.invalidate))
        effects.navigate?.let { put("navigate", ClientComposeJson.encodeToJsonElement(ScreenRef.serializer(), it)) }
    }
}
