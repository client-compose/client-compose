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

    /// Calls `onInvalidate` on the main actor whenever an action invalidates this screen, until the
    /// returned watch is cancelled or released. Screen models use it to reload.
    public func watch(
        screen: String,
        params: [String: String],
        onInvalidate: @escaping @MainActor @Sendable () -> Void
    ) async -> ScreenWatch {
        let id = await store.watch(screen: screen, params: params, onInvalidate: onInvalidate)
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
    /// - Parameter idempotencyKey: One per user intent. Pass the same key again to retry it.
    public func perform<A: ActionDescriptor>(
        _ action: A.Type,
        _ input: A.Input,
        idempotencyKey: String = UUID().uuidString
    ) async throws -> ActionOutcome<A.Result, A.DeclaredError> {
        let request = ActionRequest(
            protocol: ClientCompose.protocolVersion,
            action: A.action,
            version: A.version,
            input: input,
            client: context,
            idempotencyKey: idempotencyKey
        )
        let response = try await post(path: "actions/\(A.action)", body: JSONEncoder().encode(request))
        let outcome: ActionOutcome<A.Result, A.DeclaredError> = try Self.outcome(of: response)
        if case .ok(_, let effects) = outcome { await apply(effects) }
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

    private func apply(_ effects: ActionEffects) async {
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

    func watch(screen: String, params: [String: String], onInvalidate: @escaping @MainActor @Sendable () -> Void) -> UUID {
        let id = UUID()
        watchers[id] = Watcher(screen: screen, params: params, onInvalidate: onInvalidate)
        return id
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
