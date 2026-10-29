package dev.clientcompose

import dev.clientcompose.testing.FakeComposer
import dev.clientcompose.testing.FakeIsland
import dev.clientcompose.testing.FakeResponse
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

// Stand-ins for generated types.
@Serializable
data class HeaderV1(val name: String) {
    companion object : IslandDescriptor<HeaderV1> {
        override val type = "header"
        override val version = 1
        override val propsSerializer: KSerializer<HeaderV1> get() = serializer()
    }
}

object FollowV1 : ActionDescriptor<FollowV1.Input, FollowV1.Result, FollowV1.Error> {
    override val action = "follow"
    override val version = 1
    override val inputSerializer: KSerializer<Input> get() = Input.serializer()
    override val resultSerializer: KSerializer<Result> get() = Result.serializer()
    override val errorCodes = listOf("blocked")
    override fun decodeError(code: String, details: JsonElement?, json: Json): Error = Error.Blocked
    override fun encodeErrorDetails(error: Error, json: Json): JsonElement? = null

    @Serializable
    data class Input(val userId: String)

    @Serializable
    data class Result(val followers: Int)

    sealed interface Error : DeclaredError {
        data object Blocked : Error {
            override val code: String get() = "blocked"
        }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ComposeClientTest {
    private val context = ClientContext(appVersion = "1")
    private val islands = mapOf("header" to listOf(1))

    private fun profile(counter: AtomicInteger, cacheMaxAge: Int? = 60) = FakeComposer().screen("profile") {
        FakeResponse.screen("profile", listOf(FakeIsland.island("header", HeaderV1, HeaderV1("Ada ${counter.incrementAndGet()}"))), title = "Ada", cacheMaxAge = cacheMaxAge)
    }

    @Test
    fun cachesScreensForTheirMaxAgeAndReloadBypassesIt() = runTest {
        val composer = profile(AtomicInteger())
        val client = ComposeClient(composer, context)
        client.screen("profile", mapOf("userId" to "u1"), islands)
        client.screen("profile", mapOf("userId" to "u1"), islands)
        assertEquals(1, composer.screenRequests.size)
        client.screen("profile", mapOf("userId" to "u1"), islands, reload = true)
        client.screen("profile", mapOf("userId" to "u2"), islands)
        assertEquals(3, composer.screenRequests.size)
        assertEquals(islands, composer.screenRequests[0].islands)
    }

    @Test
    fun actionsInvalidateScreensAndNavigate() = runTest {
        val navigated = mutableListOf<ScreenRef>()
        val composer = profile(AtomicInteger()).action(FollowV1) { input ->
            FakeResponse.ok(FollowV1, FollowV1.Result(8), invalidate = listOf(ScreenRef("profile", mapOf("userId" to input.userId))), navigate = ScreenRef("feed"))
        }
        val client = ComposeClient(composer, context, onNavigate = { navigated += it })
        client.screen("profile", mapOf("userId" to "u1"), islands)
        client.screen("profile", mapOf("userId" to "u2"), islands)

        val outcome = client.perform(FollowV1, FollowV1.Input("u1"), idempotencyKey = "k1")
        assertEquals(ActionOutcome.Ok(FollowV1.Result(8), ActionEffects(invalidate = listOf(ScreenRef("profile", mapOf("userId" to "u1"))), navigate = ScreenRef("feed"))), outcome)
        assertEquals("k1", composer.actionRequests.single().idempotencyKey)
        assertEquals(FollowV1.Input("u1"), composer.actionRequests.single().input(FollowV1.inputSerializer))
        assertEquals(listOf(ScreenRef("feed")), navigated)

        // u1 was invalidated, so it's fetched again; u2 is still cached.
        client.screen("profile", mapOf("userId" to "u1"), islands)
        client.screen("profile", mapOf("userId" to "u2"), islands)
        assertEquals(3, composer.screenRequests.size)
    }

    @Test
    fun declaredErrorsAreValuesAndFailuresAreThrown() = runTest {
        val composer = FakeComposer().action(FollowV1) { input ->
            if (input.userId == "blocker") FakeResponse.error(FollowV1, FollowV1.Error.Blocked) else FakeResponse.failure(401, "unauthenticated")
        }
        val client = ComposeClient(composer, context)
        assertEquals(ActionOutcome.Error(FollowV1.Error.Blocked), client.perform(FollowV1, FollowV1.Input("blocker")))
        val failure = assertFailsWith<ActionFailure> { client.perform(FollowV1, FollowV1.Input("u1")) }
        assertEquals(401, failure.status)
        assertEquals("unauthenticated", failure.code)
    }

    @Test
    fun headersAreWorkedOutForEachRequest() = runTest {
        val tokens = AtomicInteger()
        val composer = profile(AtomicInteger(), cacheMaxAge = null)
        val client = ComposeClient(composer, context, headers = { mapOf("Authorization" to "Bearer ${tokens.incrementAndGet()}") })
        client.screen("profile", islands = emptyMap())
        client.screen("profile", islands = emptyMap())
        assertEquals(listOf("Bearer 1", "Bearer 2"), composer.screenRequests.map { it.headers["Authorization"] })
    }

    @Test
    fun unhandledRequestsFail() = runTest {
        assertFailsWith<FakeComposer.Unhandled> { ComposeClient(FakeComposer(), context).screen("nowhere", islands = emptyMap()) }
    }

    @Test
    fun screenStateLoadsAndReloadsWhenInvalidated() = runTest {
        val composer = profile(AtomicInteger()).action(FollowV1) { FakeResponse.ok(FollowV1, FollowV1.Result(1), invalidate = listOf(ScreenRef("profile"))) }
        val client = ComposeClient(composer, context)
        val registry = IslandRegistry<String>().register(HeaderV1) { props, _ -> props.name }
        val state = ScreenState(client, registry, "profile", mapOf("userId" to "u1"), backgroundScope)

        assertEquals(ScreenState.Status.LOADING, state.state.value.status)
        state.load().join()
        assertEquals(ScreenState.Status.READY, state.state.value.status)
        assertEquals(listOf("Ada 1"), state.state.value.islands.map { it.output })
        assertEquals("Ada", state.state.value.meta?.title)

        val follow = ActionState(client, FollowV1)
        assertIs<ActionResult.Ok<FollowV1.Result>>(follow.run(FollowV1.Input("u1")))
        assertEquals(0, follow.inFlight.value)
        // The invalidation reloads the screen.
        state.state.first { snapshot -> snapshot.islands.map { it.output } == listOf("Ada 2") }
        assertEquals(2, composer.screenRequests.size)
    }

    @Test
    fun screenStateKeepsIslandsWhenAReloadFails() = runTest {
        val calls = AtomicInteger()
        val composer = FakeComposer().screen("profile") {
            if (calls.incrementAndGet() == 1) FakeResponse.screen("profile", listOf(FakeIsland.island("header", HeaderV1, HeaderV1("Ada")))) else FakeResponse.failure(404, "not_found")
        }
        val registry = IslandRegistry<String>().register(HeaderV1) { props, _ -> props.name }
        val state = ScreenState(ComposeClient(composer, context), registry, "profile", scope = backgroundScope)
        state.load().join()
        state.reload().join()
        assertEquals(ScreenState.Status.READY, state.state.value.status)
        assertEquals(1, state.state.value.islands.size)
        assertTrue((state.state.value.error as ScreenException).isNotFound)
    }

    @Test
    fun actionStateReportsFailuresAsResults() = runTest {
        val follow = ActionState(ComposeClient(FakeComposer(), context), FollowV1)
        val result = follow.run(FollowV1.Input("u1"))
        assertTrue(result.failed)
        assertTrue(follow.last.value.failed)
        assertNull(follow.last.value.declaredError)
        follow.reset()
        assertNull(follow.last.value)
    }
}
