import ClientCompose
import ClientComposeTesting
import Foundation
import XCTest
#if canImport(SwiftUI)
import ClientComposeSwiftUI
import SwiftUI
#endif

// Stand-ins for generated types.
struct HeaderV1: IslandProps, Codable, Equatable, Sendable {
    static let islandType = "header"
    static let islandVersion = 1
    let name: String
}

enum FollowV1: ActionDescriptor {
    static let action = "follow"
    static let version = 1

    struct Input: Codable, Equatable, Sendable {
        let userId: String
    }

    struct Result: Codable, Equatable, Sendable {
        let followers: Int
    }

    enum DeclaredError: DeclaredActionError {
        case blocked

        static let codes = ["blocked"]

        init(code: String, details: JSONValue?) throws {
            guard code == "blocked" else { throw ActionFailure(status: 200, code: code, body: Data()) }
            self = .blocked
        }

        var code: String { "blocked" }
        var details: JSONValue? { nil }
    }
}

/// Counts the names it hands out, so tests can see when a screen is fetched again.
final class Counter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func next() -> Int {
        lock.lock()
        defer { lock.unlock() }
        count += 1
        return count
    }
}

final class ComposeClientTests: XCTestCase {
    private let context = ClientContext(appVersion: "1")

    private func profile(_ counter: Counter, cacheMaxAge: Int? = 60) -> FakeComposer {
        FakeComposer().screen("profile") { _ in
            .screen("profile", [.island("header", HeaderV1(name: "Ada \(counter.next())"))], title: "Ada", cacheMaxAge: cacheMaxAge)
        }
    }

    func testCachesScreensForTheirMaxAgeAndReloadBypassesIt() async throws {
        let counter = Counter()
        let composer = profile(counter)
        let client = ComposeClient(transport: composer, context: context)
        let islands = ["header": [1]]

        _ = try await client.screen("profile", params: ["userId": "u1"], islands: islands)
        _ = try await client.screen("profile", params: ["userId": "u1"], islands: islands)
        XCTAssertEqual(composer.screenRequests.count, 1)
        _ = try await client.screen("profile", params: ["userId": "u1"], islands: islands, reload: true)
        XCTAssertEqual(composer.screenRequests.count, 2)
        _ = try await client.screen("profile", params: ["userId": "u2"], islands: islands)
        XCTAssertEqual(composer.screenRequests.count, 3)
        XCTAssertEqual(composer.screenRequests[0].islands, islands)
    }

    func testActionsInvalidateScreensAndNavigate() async throws {
        let counter = Counter()
        let navigated = Counter()
        let composer = profile(counter)
            .action(FollowV1.self) { input in
                .ok(FollowV1.self, .init(followers: 8), invalidate: [ScreenRef(screen: "profile", params: ["userId": input.userId])], navigate: ScreenRef(screen: "feed"))
            }
        let client = ComposeClient(transport: composer, context: context, onNavigate: { ref in
            XCTAssertEqual(ref, ScreenRef(screen: "feed"))
            _ = navigated.next()
        })
        let islands = ["header": [1]]
        _ = try await client.screen("profile", params: ["userId": "u1"], islands: islands)
        _ = try await client.screen("profile", params: ["userId": "u2"], islands: islands)

        let outcome = try await client.perform(FollowV1.self, .init(userId: "u1"), idempotencyKey: "k1")
        XCTAssertEqual(outcome.result, .init(followers: 8))
        XCTAssertEqual(composer.actionRequests.first?.idempotencyKey, "k1")
        XCTAssertEqual(try composer.actionRequests.first?.input(as: FollowV1.Input.self), .init(userId: "u1"))
        XCTAssertEqual(navigated.next(), 2, "navigate reached the app once")

        // u1 was invalidated, so it's fetched again; u2 is still cached.
        _ = try await client.screen("profile", params: ["userId": "u1"], islands: islands)
        _ = try await client.screen("profile", params: ["userId": "u2"], islands: islands)
        XCTAssertEqual(composer.screenRequests.count, 3)
    }

    func testDeclaredErrorsAreValuesAndFailuresAreThrown() async throws {
        let composer = FakeComposer()
            .action(FollowV1.self) { input in
                input.userId == "blocker" ? .error(FollowV1.self, .blocked) : .failure(401, "unauthenticated")
            }
        let client = ComposeClient(transport: composer, context: context)
        let blocked = try await client.perform(FollowV1.self, .init(userId: "blocker"))
        XCTAssertEqual(blocked.declaredError, .blocked)
        do {
            _ = try await client.perform(FollowV1.self, .init(userId: "u1"))
            XCTFail("expected a failure")
        } catch let failure as ActionFailure {
            XCTAssertEqual(failure.status, 401)
            XCTAssertEqual(failure.code, "unauthenticated")
        }
    }

    func testHeadersAreWorkedOutForEachRequest() async throws {
        let counter = Counter()
        let tokens = Counter()
        let composer = profile(counter, cacheMaxAge: nil)
        let client = ComposeClient(transport: composer, context: context, headers: {
            ["Authorization": "Bearer \(tokens.next())"]
        })
        _ = try await client.screen("profile", islands: [:])
        _ = try await client.screen("profile", islands: [:])
        XCTAssertEqual(composer.screenRequests.map { $0.headers["Authorization"] }, ["Bearer 1", "Bearer 2"])
    }

    func testUnhandledRequestsFail() async throws {
        let client = ComposeClient(transport: FakeComposer(), context: context)
        do {
            _ = try await client.screen("nowhere", islands: [:])
            XCTFail("expected FakeComposer.Unhandled")
        } catch is FakeComposer.Unhandled {}
    }

    // MARK: SwiftUI models
    #if canImport(SwiftUI)

    @MainActor
    func testScreenModelLoadsAndReloadsWhenInvalidated() async throws {
        let counter = Counter()
        let composer = profile(counter)
            .action(FollowV1.self) { _ in .ok(FollowV1.self, .init(followers: 1), invalidate: [ScreenRef(screen: "profile")]) }
        let client = ComposeClient(transport: composer, context: context)
        let registry = IslandRegistry<AnyView>().register(HeaderV1.self) { props, _ in AnyView(Text(props.name)) }
        let model = ScreenModel(screen: "profile", params: ["userId": "u1"], client: client, registry: registry)

        XCTAssertEqual(model.status, .loading)
        await model.load()
        XCTAssertEqual(model.status, .ready)
        XCTAssertEqual(model.islands.map(\.id), ["header"])
        XCTAssertEqual(model.meta?.title, "Ada")

        let follow = ActionModel<FollowV1>(client: client)
        let result = await follow.run(.init(userId: "u1"))
        XCTAssertNil(result.declaredError)
        XCTAssertFalse(follow.pending)

        // The invalidation reloads the model on the main actor.
        for _ in 0..<50 where composer.screenRequests.count < 2 {
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(composer.screenRequests.count, 2)
    }

    @MainActor
    func testScreenModelKeepsIslandsWhenAReloadFails() async throws {
        let counter = Counter()
        let composer = FakeComposer().screen("profile") { _ in
            counter.next() == 1 ? .screen("profile", [.island("header", HeaderV1(name: "Ada"))]) : .failure(404, "not_found")
        }
        let client = ComposeClient(transport: composer, context: context)
        let registry = IslandRegistry<AnyView>().register(HeaderV1.self) { props, _ in AnyView(Text(props.name)) }
        let model = ScreenModel(screen: "profile", client: client, registry: registry)

        await model.load()
        await model.reload()
        XCTAssertEqual(model.status, .ready)
        XCTAssertEqual(model.islands.count, 1)
        XCTAssertEqual((model.error as? ScreenError)?.isNotFound, true)
    }

    @MainActor
    func testActionModelWithoutAClientFails() async {
        let follow = ActionModel<FollowV1>()
        let result = await follow.run(.init(userId: "u1"))
        XCTAssertTrue(result.failed)
        XCTAssertTrue(follow.last?.failed == true)
        follow.reset()
        XCTAssertNil(follow.last)
    }
    #endif
}
