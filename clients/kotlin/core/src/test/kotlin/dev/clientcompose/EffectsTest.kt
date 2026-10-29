package dev.clientcompose

import dev.clientcompose.testing.FakeComposer
import dev.clientcompose.testing.FakeIsland
import dev.clientcompose.testing.FakeResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Stand-ins for generated types: a list of todos, and how many are left (spec §2.1).
@Serializable
data class Todo(val id: String, val title: String, val done: Boolean)

@Serializable
data class TodosV1(val todos: List<Todo>) {
    companion object : IslandDescriptor<TodosV1> {
        override val type = "todos"
        override val version = 1
        override val propsSerializer: KSerializer<TodosV1> get() = serializer()
        override val entities = listOf(EntityPath(listOf("todos", "[]"), "todo", "id", listOf("id", "title", "done")))
    }
}

@Serializable
data class LeftV1(val id: String, val left: Int) {
    companion object : IslandDescriptor<LeftV1> {
        override val type = "left"
        override val version = 1
        override val propsSerializer: KSerializer<LeftV1> get() = serializer()
        override val entities = listOf(EntityPath(emptyList(), "todo-count", "id", listOf("id", "left")))
    }
}

object ToggleV1 : ActionDescriptor<ToggleV1.Input, ToggleV1.Result, Nothing> {
    override val action = "toggle"
    override val version = 1
    override val inputSerializer: KSerializer<Input> get() = Input.serializer()
    override val resultSerializer: KSerializer<Result> get() = Result.serializer()
    override val errorCodes = emptyList<String>()
    override fun decodeError(code: String, details: JsonElement?, json: Json): Nothing = error("no declared errors")
    override fun encodeErrorDetails(error: Nothing, json: Json): JsonElement? = null

    @Serializable
    class Input

    @Serializable
    class Result
}

@OptIn(ExperimentalCoroutinesApi::class)
class EffectsTest {
    private val context = ClientContext(appVersion = "1")
    private val milk = Todo("1", "Milk", false)
    private val eggs = Todo("2", "Eggs", false)
    private val registry = IslandRegistry<String>()
        .register(TodosV1) { props, _ -> props.todos.joinToString(",") { it.title } }
        .register(LeftV1) { props, _ -> "${props.left} left" }

    private fun todos(list: List<Todo>) = FakeResponse.screen(
        "todos",
        listOf(FakeIsland.island("todos", TodosV1, TodosV1(list)), FakeIsland.island("left", LeftV1, LeftV1("me", list.size))),
        cacheMaxAge = 60,
    )

    private fun set(entity: String, id: String, vararg values: Pair<String, JsonElement>) =
        EntityChange(entity, id, set = JsonObject(values.toMap()))

    private inline fun <reified P> ScreenResponse.props(key: String, island: IslandDescriptor<P>): P =
        ClientComposeJson.decodeFromJsonElement(island.propsSerializer, assertNotNull(islands.first { it.key == key }.props))

    private suspend fun fetched(list: List<Todo>): ScreenResponse =
        ComposeClient(FakeComposer().screen("todos") { todos(list) }, context).screen("todos", islands = registry.capabilities)

    @Test
    fun changesReachCachedScreensWithoutFetchingThemAgain() = runTest {
        val composer = FakeComposer().screen("todos") { todos(listOf(milk, eggs)) }.action(ToggleV1) {
            FakeResponse.ok(
                ToggleV1,
                ToggleV1.Result(),
                changes = listOf(set("todo", "2", "done" to JsonPrimitive(true)), set("todo-count", "me", "left" to JsonPrimitive(1))),
            )
        }
        val client = ComposeClient(composer, context)
        client.screen("todos", islands = registry.capabilities)

        client.perform(ToggleV1, ToggleV1.Input(), registry.catalog)

        val after = client.screen("todos", islands = registry.capabilities)
        assertEquals(listOf(false, true), after.props("todos", TodosV1).todos.map { it.done })
        assertEquals(1, after.props("left", LeftV1).left)
        assertEquals(1, composer.screenRequests.size)
        assertEquals(mapOf("todos" to listOf(1), "left" to listOf(1)), composer.actionRequests.single().islands)
    }

    @Test
    fun anUpdateSwapsItsIslandInAndOneThatCantBeTakenReloads() = runTest {
        val screen = fetched(listOf(milk))
        val bread = Todo("3", "Bread", false)
        val update = { key: String -> IslandUpdate("todos", emptyMap(), screen.islands.first { it.key == "todos" }.copy(key = key, props = ClientComposeJson.encodeToJsonElement(TodosV1.propsSerializer, TodosV1(listOf(bread))) as JsonObject)) }

        val swapped = assertNotNull(EffectsBatch(ActionEffects(update = listOf(update("todos"))), registry.catalog).apply(screen, emptyMap()))
        assertEquals(listOf(bread), swapped.props("todos", TodosV1).todos)
        assertEquals(1, swapped.props("left", LeftV1).left, "the rest stays")

        assertNull(EffectsBatch(ActionEffects(update = listOf(update("summary"))), registry.catalog).apply(screen, emptyMap()))
    }

    @Test
    fun aDeletedEntityLeavesItsListAndElsewhereReloads() = runTest {
        val screen = fetched(listOf(milk, eggs))
        val deleted = { entity: String, id: String -> EffectsBatch(ActionEffects(changes = listOf(EntityChange(entity, id, delete = true))), registry.catalog) }

        val fromList = assertNotNull(deleted("todo", "1").apply(screen, emptyMap()))
        assertEquals(listOf(eggs), fromList.props("todos", TodosV1).todos)
        // The count is the props themselves: it can't be removed, so the screen reloads.
        assertNull(deleted("todo-count", "me").apply(screen, emptyMap()))
    }

    @Test
    fun aScreenStateShowsAnActionsChangesWithoutReloading() = runTest {
        val composer = FakeComposer().screen("todos") { todos(listOf(milk)) }.action(ToggleV1) {
            FakeResponse.ok(ToggleV1, ToggleV1.Result(), changes = listOf(set("todo", "1", "title" to JsonPrimitive("Oat milk"))))
        }
        val client = ComposeClient(composer, context, cache = false)
        val state = ScreenState(client, registry, "todos", scope = backgroundScope)
        state.load().join()

        ActionState(client, ToggleV1, registry.catalog).run(ToggleV1.Input())

        state.state.first { snapshot -> snapshot.islands.map { it.output } == listOf("Oat milk", "1 left") }
        assertEquals(1, composer.screenRequests.size)
    }
}
