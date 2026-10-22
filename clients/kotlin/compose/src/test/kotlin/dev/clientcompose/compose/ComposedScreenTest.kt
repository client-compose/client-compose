package dev.clientcompose.compose

import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.material3.Text
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.clientcompose.ActionDescriptor
import dev.clientcompose.ClientContext
import dev.clientcompose.ComposeClient
import dev.clientcompose.DeclaredError
import dev.clientcompose.IslandDescriptor
import dev.clientcompose.IslandRegistry
import dev.clientcompose.ScreenException
import dev.clientcompose.ScreenRef
import dev.clientcompose.testing.FakeComposer
import dev.clientcompose.testing.FakeIsland
import dev.clientcompose.testing.FakeResponse
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

// Stand-ins for generated types.
@Serializable
data class CounterV1(val count: Int) {
    companion object : IslandDescriptor<CounterV1> {
        override val type = "counter"
        override val version = 1
        override val propsSerializer: KSerializer<CounterV1> get() = serializer()
    }
}

object IncrementV1 : ActionDescriptor<IncrementV1.Input, IncrementV1.Result, Nothing> {
    override val action = "increment"
    override val version = 1
    override val inputSerializer: KSerializer<Input> get() = Input.serializer()
    override val resultSerializer: KSerializer<Result> get() = Result.serializer()
    override val errorCodes = emptyList<String>()
    override fun decodeError(code: String, details: JsonElement?, json: Json): Nothing = throw IllegalArgumentException(code)
    override fun encodeErrorDetails(error: Nothing, json: Json): JsonElement? = null

    @Serializable
    class Input

    @Serializable
    class Result
}

@RunWith(RobolectricTestRunner::class)
class ComposedScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Composable
    private fun Counter(props: CounterV1) {
        val increment = rememberAction(IncrementV1)
        Button(onClick = { increment.run(IncrementV1.Input()) }, enabled = !increment.pending) {
            Text("Count ${props.count}")
        }
    }

    @Test
    fun showsIslandsAndReloadsWhenAnActionInvalidatesTheScreen() {
        val count = AtomicInteger()
        val composer = FakeComposer()
            .screen("counter") { FakeResponse.screen("counter", listOf(FakeIsland.island("counter", CounterV1, CounterV1(count.get()))), title = "Counter") }
            .action(IncrementV1) {
                count.incrementAndGet()
                FakeResponse.ok(IncrementV1, IncrementV1.Result(), invalidate = listOf(ScreenRef("counter")))
            }
        val client = ComposeClient(composer, ClientContext(appVersion = "1"))
        val registry = IslandRegistry<IslandContent>().register(CounterV1) { props, _ -> { Counter(props) } }
        var title: String? = null

        compose.setContent {
            ProvideCompose(client, registry) {
                ComposedScreen("counter", onMeta = { title = it?.title })
            }
        }
        compose.waitUntil { composer.screenRequests.isNotEmpty() }
        compose.onNodeWithText("Count 0").assertExists()
        assertEquals("Counter", title)

        compose.onNodeWithText("Count 0").performClick()
        compose.waitUntil { composer.screenRequests.size == 2 }
        compose.onNodeWithText("Count 1").assertExists()
    }

    @Test
    fun showsFailureWithTheScreensError() {
        val composer = FakeComposer().screen("gone") { FakeResponse.failure(404, "not_found") }
        val client = ComposeClient(composer, ClientContext(appVersion = "1"))

        compose.setContent {
            ProvideCompose(client, IslandRegistry()) {
                ComposedScreen("gone", failure = { error, _ ->
                    Text(if ((error as? ScreenException)?.isNotFound == true) "Not here" else "Broken")
                })
            }
        }
        compose.waitUntil { composer.screenRequests.isNotEmpty() }
        compose.onNodeWithText("Not here").assertExists()
    }
}
