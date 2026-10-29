import Foundation

/// Talks to a composer: fetches screens and performs actions, applies what actions changed
/// (spec §5.3), and keeps screens for their `cache.maxAge`.
///
///     let client = ComposeClient(
///         baseURL: URL(string: "https://api.example.com/compose")!,
///         context: ClientContext(appVersion: "4.2.0"),
///         headers: { ["Authorization": "Bearer \(try await session.token())"] },
///         onNavigate: { ref in router.show(ref) }
///     )
///
/// Use one client for the app. SwiftUI apps hand it to `ComposedScreen` with `.compose(client:registry:)`.
public final class ComposeClient: Sendable {
    public let context: ClientContext
    private let transport: Transport
    private let headers: @Sendable () async throws -> [String: String]
    private let onNavigate: (@MainActor @Sendable (ScreenRef) -> Void)?
    private let store: ScreenStore

    /// - Parameters:
    ///   - headers: Headers for every request, worked out each time, e.g. a fresh token.
    ///   - cache: Keep screens for their `cache.maxAge`. Default true.
    ///   - onNavigate: Called with an action's `navigate` effect. Map the screen to a route.
    public convenience init(
        baseURL: URL,
        context: ClientContext,
        headers: @escaping @Sendable () async throws -> [String: String] = { [:] },
        cache: Bool = true,
        onNavigate: (@MainActor @Sendable (ScreenRef) -> Void)? = nil
    ) {
        self.init(transport: URLSessionTransport(baseURL: baseURL), context: context, headers: headers, cache: cache, onNavigate: onNavigate)
    }

    /// A client that sends requests through `transport`: your own, or `FakeComposer` in tests.
    public init(
        transport: Transport,
        context: ClientContext,
        headers: @escaping @Sendable () async throws -> [String: String] = { [:] },
        cache: Bool = true,
        onNavigate: (@MainActor @Sendable (ScreenRef) -> Void)? = nil
    ) {
        self.transport = transport
        self.context = context
        self.headers = headers
        self.onNavigate = onNavigate
        self.store = ScreenStore(enabled: cache)
    }

    // MARK: Screens

    /// The screen, from the cache while it's fresh unless `reload` is set. Throws `ScreenError` when
    /// the composer answers with an error (`isNotFound`, `isUnauthenticated`, `isForbidden`).
    ///
    /// - Parameter islands: The app's capabilities, usually `registry.capabilities`.
    public func screen(
        _ screen: String,
        params: [String: String] = [:],
        islands: [String: [Int]],
        reload: Bool = false
    ) async throws -> ScreenResponse {
        if !reload, let cached = await store.cached(screen: screen, params: params) {
            return cached
        }
        let request = ScreenRequest(protocol: ClientCompose.protocolVersion, screen: screen, params: params, client: context, islands: islands)
        let response = try await post(path: "screens/\(screen)", body: JSONEncoder().encode(request))
        guard (200..<300).contains(response.status) else {
            throw ScreenError(status: response.status, code: ErrorBody.code(in: response.body), body: response.body)
        }
        // The screen streams (spec §4.6); it's read to its end and shown all at once.
        let decoded = try ScreenStream.read(response.body)
        await store.remember(decoded, screen: screen, params: params)
        return decoded
    }

    /// Calls `onInvalidate` on the main actor whenever an action invalidates this screen, and
    /// `onEffects` with every action's changes and updates, until the returned watch is cancelled or
    /// released. Screen models use them to reload, or to apply the changes to what they show.
    public func watch(
        screen: String,
        params: [String: String],
        onEffects: @escaping @MainActor @Sendable (EffectsBatch) -> Void = { _ in },
        onInvalidate: @escaping @MainActor @Sendable () -> Void
    ) async -> ScreenWatch {
        let id = await store.watch(screen: screen, params: params, onEffects: onEffects, onInvalidate: onInvalidate)
        return ScreenWatch { [store] in Task { await store.unwatch(id) } }
    }

    // MARK: Strings

    /// The app strings in the client's language (spec §4.7). Fetch them when the app starts, and keep
    /// them for the next launch; throws `ScreenError` when the composer answers with an error.
    ///
    ///     let words = try await client.strings().app(AppStrings.self)
    public func strings() async throws -> StringsResponse {
        let request = StringsRequest(protocol: ClientCompose.protocolVersion, client: context)
        let response = try await post(path: "strings", body: JSONEncoder().encode(request))
        guard (200..<300).contains(response.status) else {
            throw ScreenError(status: response.status, code: ErrorBody.code(in: response.body), body: response.body)
        }
        return try JSONDecoder().decode(StringsResponse.self, from: response.body)
    }

    // MARK: Actions

    /// Performs an action by its generated descriptor. Returns its result or one of its declared
    /// errors; anything else throws `ActionFailure`. On success its effects are applied first:
    /// invalidated screens are dropped from the cache and reloaded where they're on show, and
    /// `navigate` goes to `onNavigate`.
    ///
    ///     switch try await client.perform(RenameThingV1.self, .init(thingId: id, name: name)) {
    ///     case .ok(let result, _): show(result.thing)
    ///     case .error(.nameTaken(let details)): suggest(details.suggestions)
    ///     case .error(.locked): showLocked()
    ///     }
    ///
    /// - Parameter islands: The app's islands, usually `registry.catalog`: the composer resolves the
    ///   islands an action updates at their versions, and its changes reach the islands holding
    ///   their entities (spec §5.2, §5.3).
    /// - Parameter idempotencyKey: One per user intent. Pass the same key again to retry it.
    public func perform<A: ActionDescriptor>(
        _ action: A.Type,
        _ input: A.Input,
        islands: IslandCatalog = .empty,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> ActionOutcome<A.Result, A.DeclaredError> {
        let request = ActionRequest(
            protocol: ClientCompose.protocolVersion,
            action: A.action,
            version: A.version,
            input: input,
            client: context,
            islands: islands.capabilities,
            idempotencyKey: idempotencyKey
        )
        let response = try await post(path: "actions/\(A.action)", body: JSONEncoder().encode(request))
        let outcome: ActionOutcome<A.Result, A.DeclaredError> = try Self.outcome(of: response)
        if case .ok(_, let effects) = outcome { await apply(EffectsBatch(effects: effects, catalog: islands)) }
        return outcome
    }

    /// Reads an action response (spec §5.3, conformance/client/action-cases.json).
    static func outcome<Result: Decodable & Sendable, DeclaredError: DeclaredActionError>(
        of response: TransportResponse
    ) throws -> ActionOutcome<Result, DeclaredError> {
        let failure = { (code: String?) in ActionFailure(status: response.status, code: code, body: response.body) }
        guard (200..<300).contains(response.status) else { throw failure(ErrorBody.code(in: response.body)) }
        guard let raw = try? JSONDecoder().decode(RawActionResponse.self, from: response.body) else { throw failure(nil) }
        switch raw.status {
        case "ok":
            guard let result = try? (raw.result ?? .object([:])).decode(Result.self) else { throw failure(nil) }
            return .ok(result, raw.effects ?? ActionEffects())
        case "error":
            guard let code = raw.error?.code else { throw failure(nil) }
            guard DeclaredError.codes.contains(code), let declared = try? DeclaredError(code: code, details: raw.error?.details) else {
                throw failure(code) // a code this app version doesn't know (spec §5.1)
            }
            return .error(declared)
        default:
            throw failure(nil)
        }
    }

    /// Applies an action's effects in the spec's order: changes and updates, then invalidations,
    /// then navigation (spec §5.3).
    private func apply(_ batch: EffectsBatch) async {
        let effects = batch.effects
        if batch.touchesScreens { await store.change(batch) }
        if !effects.invalidate.isEmpty { await store.invalidate(effects.invalidate) }
        if let ref = effects.navigate, let onNavigate { await onNavigate(ref) }
    }

    private func post(path: String, body: Data) async throws -> TransportResponse {
        try await transport.post(path: path, body: body, headers: headers())
    }
}

/// Stops a `ComposeClient.watch` when cancelled or released.
public final class ScreenWatch: Sendable {
    private let stop: @Sendable () -> Void

    init(stop: @escaping @Sendable () -> Void) {
        self.stop = stop
    }

    public func cancel() { stop() }

    deinit { stop() }
}

struct ActionRequest<Input: Encodable>: Encodable {
    let `protocol`: Int
    let action: String
    let version: Int
    let input: Input
    let client: ClientContext
    let islands: [String: [Int]]
    let idempotencyKey: String
}

private struct RawActionResponse: Decodable {
    struct RawError: Decodable {
        let code: String?
        let details: JSONValue?
    }

    let status: String?
    let result: JSONValue?
    let effects: ActionEffects?
    let error: RawError?
}

/// Cached screens, and the screens on show that actions may invalidate.
actor ScreenStore {
    private struct Entry {
        let screen: String
        let params: [String: String]
        let response: ScreenResponse
        let expires: Date
    }

    private struct Watcher {
        let screen: String
        let params: [String: String]
        let onEffects: @MainActor @Sendable (EffectsBatch) -> Void
        let onInvalidate: @MainActor @Sendable () -> Void
    }

    private let enabled: Bool
    private var entries: [String: Entry] = [:]
    private var watchers: [UUID: Watcher] = [:]

    init(enabled: Bool) {
        self.enabled = enabled
    }

    private func key(_ screen: String, _ params: [String: String]) -> String {
        screen + "?" + params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
    }

    func cached(screen: String, params: [String: String]) -> ScreenResponse? {
        guard let entry = entries[key(screen, params)], entry.expires > Date() else { return nil }
        return entry.response
    }

    func remember(_ response: ScreenResponse, screen: String, params: [String: String]) {
        guard enabled, let maxAge = response.cache?.maxAge, maxAge > 0 else { return }
        entries[key(screen, params)] = Entry(
            screen: screen, params: params, response: response, expires: Date().addingTimeInterval(TimeInterval(maxAge))
        )
    }

    func watch(
        screen: String,
        params: [String: String],
        onEffects: @escaping @MainActor @Sendable (EffectsBatch) -> Void,
        onInvalidate: @escaping @MainActor @Sendable () -> Void
    ) -> UUID {
        let id = UUID()
        watchers[id] = Watcher(screen: screen, params: params, onEffects: onEffects, onInvalidate: onInvalidate)
        return id
    }

    /// Applies an action's changes and updates to cached screens (dropping those it can't apply to)
    /// and hands them to the screens on show (spec §5.3).
    func change(_ batch: EffectsBatch) async {
        for (key, entry) in entries {
            if let changed = batch.apply(to: entry.response, params: entry.params) {
                entries[key] = Entry(screen: entry.screen, params: entry.params, response: changed, expires: entry.expires)
            } else {
                entries[key] = nil
            }
        }
        for watcher in watchers.values {
            await watcher.onEffects(batch)
        }
    }

    func unwatch(_ id: UUID) {
        watchers[id] = nil
    }

    func invalidate(_ refs: [ScreenRef]) async {
        let matches = { (screen: String, params: [String: String]) in refs.contains { $0.matches(screen: screen, params: params) } }
        entries = entries.filter { !matches($0.value.screen, $0.value.params) }
        for watcher in watchers.values where matches(watcher.screen, watcher.params) {
            await watcher.onInvalidate()
        }
    }
}
