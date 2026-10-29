import ClientCompose
import ClientComposeTesting
import Foundation
import XCTest
#if canImport(SwiftUI)
import ClientComposeSwiftUI
import SwiftUI
#endif

// Stand-ins for generated types: a list of todos, and how many are left (spec §2.1).
struct TodoV1: Codable, Equatable, Sendable {
    let id: String
    let title: String
    let done: Bool
}

struct TodosV1: IslandProps, Codable, Equatable, Sendable {
    static let islandType = "todos"
    static let islandVersion = 1
    static let islandEntities = [EntityPath(path: ["todos", "[]"], entity: "todo", id: "id", properties: ["id", "title", "done"])]
    let todos: [TodoV1]
}

struct LeftV1: IslandProps, Codable, Equatable, Sendable {
    static let islandType = "left"
    static let islandVersion = 1
    static let islandEntities = [EntityPath(path: [], entity: "todo-count", id: "id", properties: ["id", "left"])]
    let id: String
    let left: Int
}

enum ToggleV1: ActionDescriptor {
    static let action = "toggle"
    static let version = 1

    struct Input: Codable, Equatable, Sendable {}
    struct Result: Codable, Equatable, Sendable {}

    enum DeclaredError: DeclaredActionError {
        static let codes: [String] = []
        init(code: String, details: JSONValue?) throws { throw ActionFailure(status: 200, code: code, body: Data()) }
        var code: String { "" }
        var details: JSONValue? { nil }
    }
}

final class EffectsTests: XCTestCase {
    private let context = ClientContext(appVersion: "1")
    private let milk = TodoV1(id: "1", title: "Milk", done: false)
    private let eggs = TodoV1(id: "2", title: "Eggs", done: false)

    private var registry: IslandRegistry<String> {
        IslandRegistry<String>()
            .register(TodosV1.self) { props, _ in props.todos.map(\.title).joined(separator: ",") }
            .register(LeftV1.self) { props, _ in "\(props.left) left" }
    }

    private func todos(_ todos: [TodoV1]) -> FakeResponse {
        .screen("todos", [.island("todos", TodosV1(todos: todos)), .island("left", LeftV1(id: "me", left: todos.count))], cacheMaxAge: 60)
    }

    /// The todos screen as a client gets it.
    private func fetched(_ list: [TodoV1]) async throws -> ScreenResponse {
        let composer = FakeComposer().screen("todos") { _ in self.todos(list) }
        return try await ComposeClient(transport: composer, context: context).screen("todos", islands: registry.capabilities)
    }

    private func props<P: Decodable>(_ response: ScreenResponse, _ key: String, as type: P.Type) throws -> P {
        try XCTUnwrap(response.islands.first { $0.key == key }?.props).decode(type)
    }

    func testChangesReachCachedScreensWithoutFetchingThemAgain() async throws {
        let composer = FakeComposer()
            .screen("todos") { [milk, eggs] _ in self.todos([milk, eggs]) }
            .action(ToggleV1.self) { _ in
                .ok(ToggleV1.self, .init(), changes: [
                    EntityChange(entity: "todo", id: "2", set: ["done": .bool(true)]),
                    EntityChange(entity: "todo-count", id: "me", set: ["left": .int(1)]),
                ])
            }
        let client = ComposeClient(transport: composer, context: context)
        let catalog = registry.catalog
        _ = try await client.screen("todos", islands: catalog.capabilities)

        _ = try await client.perform(ToggleV1.self, .init(), islands: catalog)

        let after = try await client.screen("todos", islands: catalog.capabilities)
        XCTAssertEqual(try props(after, "todos", as: TodosV1.self).todos.map(\.done), [false, true])
        XCTAssertEqual(try props(after, "left", as: LeftV1.self).left, 1)
        XCTAssertEqual(composer.screenRequests.count, 1)
        XCTAssertEqual(composer.actionRequests.first?.islands, ["todos": [1], "left": [1]])
    }

    func testAnUpdateSwapsItsIslandInAndOneThatCantBeTakenReloads() async throws {
        let screen = try await fetched([milk])
        let bread = TodoV1(id: "3", title: "Bread", done: false)
        let update = try JSONDecoder().decode(ActionEffects.self, from: Data(#"""
            {"update": [{"screen": "todos", "params": {}, "island": {"key": "todos", "type": "todos", "version": 1, "status": "ok", "props": {"todos": [{"id": "3", "title": "Bread", "done": false}]}}}]}
            """#.utf8))
        let swapped = EffectsBatch(effects: update, catalog: registry.catalog).apply(to: screen, params: [:])
        XCTAssertEqual(try props(XCTUnwrap(swapped), "todos", as: TodosV1.self).todos, [bread])
        XCTAssertEqual(try props(XCTUnwrap(swapped), "left", as: LeftV1.self).left, 1, "the rest stays")

        // Another screen's params, or an island the screen doesn't have: nothing to apply, or reload.
        XCTAssertNotNil(EffectsBatch(effects: update, catalog: registry.catalog).apply(to: screen, params: ["other": "x"]))
        let unknown = try JSONDecoder().decode(ActionEffects.self, from: Data(#"""
            {"update": [{"screen": "todos", "params": {}, "island": {"key": "summary", "type": "left", "version": 1, "status": "ok", "props": {}}}]}
            """#.utf8))
        XCTAssertNil(EffectsBatch(effects: unknown, catalog: registry.catalog).apply(to: screen, params: [:]))
    }

    func testADeletedEntityLeavesItsListAndElsewhereReloads() async throws {
        let screen = try await fetched([milk, eggs])
        let deleted = { (entity: String, id: String) in
            EffectsBatch(effects: ActionEffects(changes: [EntityChange(entity: entity, id: id, delete: true)]), catalog: self.registry.catalog)
        }

        let fromList = try XCTUnwrap(deleted("todo", "1").apply(to: screen, params: [:]))
        XCTAssertEqual(try props(fromList, "todos", as: TodosV1.self).todos, [eggs])
        // The count is the props themselves: it can't be removed, so the screen reloads.
        XCTAssertNil(deleted("todo-count", "me").apply(to: screen, params: [:]))
    }

    #if canImport(SwiftUI)
    @MainActor
    func testAScreenModelShowsAnActionsChangesWithoutReloading() async throws {
        let composer = FakeComposer()
            .screen("todos") { [milk] _ in self.todos([milk]) }
            .action(ToggleV1.self) { _ in
                .ok(ToggleV1.self, .init(), changes: [EntityChange(entity: "todo", id: "1", set: ["title": .string("Oat milk")])])
            }
        let client = ComposeClient(transport: composer, context: context, cache: false)
        let views = IslandRegistry<AnyView>().register(TodosV1.self) { _, _ in AnyView(EmptyView()) }
        let model = ScreenModel(screen: "todos", client: client, registry: views)
        await model.load()

        _ = try await client.perform(ToggleV1.self, .init(), islands: views.catalog)

        XCTAssertEqual(try props(XCTUnwrap(model.response), "todos", as: TodosV1.self).todos.map(\.title), ["Oat milk"])
        XCTAssertEqual(composer.screenRequests.count, 1)
    }
    #endif
}
