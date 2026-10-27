import ClientCompose
import Foundation

/// A composer for tests (CLI-8): a `Transport` that answers screens and actions with responses you
/// build from your generated types, and records what the app sent.
///
///     let composer = FakeComposer()
///         .screen("profile") { _ in .screen("profile", [.island("header", ProfileHeaderV2(displayName: "Ada"))]) }
///         .action(FollowUserV1.self) { input in .ok(FollowUserV1.self, .init(followers: 8), invalidate: [ScreenRef(screen: "profile")]) }
///     let client = ComposeClient(transport: composer, context: ClientContext(appVersion: "1"))
///
/// A request with no handler throws `FakeComposer.Unhandled`, which fails the test.
public final class FakeComposer: Transport, @unchecked Sendable {
    public struct Unhandled: Error, CustomStringConvertible {
        public let path: String
        public var description: String { "FakeComposer has no handler for \(path)" }
    }

    /// A screen request the app sent.
    public struct ScreenRequest: Sendable {
        public let screen: String
        public let params: [String: String]
        /// The app's capabilities.
        public let islands: [String: [Int]]
        public let headers: [String: String]
    }

    /// An action request the app sent.
    public struct ActionRequest: Sendable {
        public let action: String
        public let version: Int
        public let input: JSONValue
        public let idempotencyKey: String?
        public let headers: [String: String]

        /// The input, decoded as `type`.
        public func input<Input: Decodable>(as type: Input.Type) throws -> Input {
            try input.decode(type)
        }
    }

    private let lock = NSLock()
    private var screens: [String: @Sendable (ScreenRequest) -> FakeResponse] = [:]
    private var actions: [String: @Sendable (ActionRequest) throws -> FakeResponse] = [:]
    private var recordedScreens: [ScreenRequest] = []
    private var recordedActions: [ActionRequest] = []
    private var stringsHandler: (@Sendable (ClientContextFields) -> FakeResponse)?
    private var recordedStrings: [ClientContextFields] = []

    public init() {}

    /// Answer requests for a screen.
    @discardableResult
    public func screen(_ id: String, _ handler: @escaping @Sendable (ScreenRequest) -> FakeResponse) -> Self {
        locked { screens[id] = handler }
        return self
    }

    /// Answer an action, given its decoded input.
    @discardableResult
    public func action<A: ActionDescriptor>(
        _ action: A.Type,
        _ handler: @escaping @Sendable (A.Input) -> FakeResponse
    ) -> Self where A.Input: Decodable {
        locked { actions["\(A.action)@\(A.version)"] = { request in handler(try request.input(as: A.Input.self)) } }
        return self
    }

    /// Answer strings requests (spec §4.7), given the client's language.
    @discardableResult
    public func strings(_ handler: @escaping @Sendable (ClientContextFields) -> FakeResponse) -> Self {
        locked { stringsHandler = handler }
        return self
    }

    /// Strings requests' client contexts, in the order the app sent them.
    public var stringsRequests: [ClientContextFields] { locked { recordedStrings } }

    /// Screen requests, in the order the app sent them.
    public var screenRequests: [ScreenRequest] { locked { recordedScreens } }

    /// Action requests, in the order the app sent them.
    public var actionRequests: [ActionRequest] { locked { recordedActions } }

    public func post(path: String, body: Data, headers: [String: String]) async throws -> TransportResponse {
        let json = try JSONDecoder().decode(JSONValue.self, from: body)
        guard case .object(let fields) = json else { throw Unhandled(path: path) }
        let response: FakeResponse
        if path == "strings" {
            let client = fields["client"].flatMap { value -> ClientContextFields? in
                guard case .object(let c) = value else { return nil }
                return ClientContextFields(platform: c["platform"]?.string, locale: c["locale"]?.string)
            } ?? ClientContextFields(platform: nil, locale: nil)
            guard let handler = locked({ () -> (@Sendable (ClientContextFields) -> FakeResponse)? in
                recordedStrings.append(client)
                return stringsHandler
            }) else { throw Unhandled(path: path) }
            response = handler(client)
        } else if path.hasPrefix("screens/") {
            let request = ScreenRequest(
                screen: fields["screen"]?.string ?? "",
                params: (try? fields["params"]?.decode([String: String].self)) ?? [:],
                islands: (try? fields["islands"]?.decode([String: [Int]].self)) ?? [:],
                headers: headers
            )
            guard let handler = locked({ () -> (@Sendable (ScreenRequest) -> FakeResponse)? in
                recordedScreens.append(request)
                return screens[request.screen]
            }) else { throw Unhandled(path: path) }
            response = handler(request)
        } else {
            let request = ActionRequest(
                action: fields["action"]?.string ?? "",
                version: (try? fields["version"]?.decode(Int.self)) ?? 0,
                input: fields["input"] ?? .null,
                idempotencyKey: fields["idempotencyKey"]?.string,
                headers: headers
            )
            guard let handler = locked({ () -> (@Sendable (ActionRequest) throws -> FakeResponse)? in
                recordedActions.append(request)
                return actions["\(request.action)@\(request.version)"]
            }) else { throw Unhandled(path: path) }
            response = try handler(request)
        }
        if let lines = response.stream {
            let text = try lines.map { try String(decoding: JSONEncoder().encode($0), as: UTF8.self) + "\n" }.joined()
            return TransportResponse(status: response.status, body: Data(text.utf8))
        }
        return TransportResponse(status: response.status, body: try JSONEncoder().encode(response.body))
    }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }
}

/// The client context a strings request was sent with.
public struct ClientContextFields: Sendable, Equatable {
    public let platform: String?
    public let locale: String?
}

/// A response for `FakeComposer` to send, built from your generated types.
public struct FakeResponse: Sendable {
    public let status: Int
    public let body: JSONValue
    /// A screen's stream (spec §4.6), as its lines, sent in place of `body`.
    public let stream: [JSONValue]?

    public init(status: Int, body: JSONValue, stream: [JSONValue]? = nil) {
        self.status = status
        self.body = body
        self.stream = stream
    }

    /// A screen, all at once: its stream's head with every island, then its end (spec §4.6). Give
    /// `locale` and `plurals` for islands with counted strings (spec §4.7).
    public static func screen(
        _ id: String,
        _ islands: [FakeIsland],
        title: String? = nil,
        cacheMaxAge: Int? = nil,
        locale: String? = nil,
        plurals: PluralRules? = nil
    ) -> FakeResponse {
        var body: [String: JSONValue] = [
            "kind": .string("head"),
            "protocol": .int(ClientCompose.protocolVersion),
            "screen": .string(id),
            "islands": .array(islands.map(\.json)),
        ]
        if let title { body["meta"] = .object(["title": .string(title)]) }
        if let cacheMaxAge { body["cache"] = .object(["maxAge": .int(cacheMaxAge)]) }
        if let locale { body["locale"] = .string(locale) }
        if let plurals { body["plurals"] = (try? JSONValue(encoding: plurals)) ?? .object([:]) }
        return FakeResponse(status: 200, body: .null, stream: [.object(body), .object(["kind": .string("end")])])
    }

    /// The app strings in a language (spec §4.7).
    public static func strings(_ locale: String, _ strings: [String: StringTemplate], plurals: PluralRules = [:]) -> FakeResponse {
        let response = StringsResponse(locale: locale, plurals: plurals, strings: strings)
        return FakeResponse(status: 200, body: (try? JSONValue(encoding: response)) ?? .null)
    }

    /// A failed screen or action request, e.g. `.failure(404, "not_found")`.
    public static func failure(_ status: Int, _ code: String) -> FakeResponse {
        FakeResponse(status: status, body: .object(["protocol": .int(ClientCompose.protocolVersion), "error": .object(["code": .string(code)])]))
    }

    /// An action's result, and the screens it changed.
    public static func ok<A: ActionDescriptor>(
        _ action: A.Type,
        _ result: A.Result,
        invalidate: [ScreenRef] = [],
        navigate: ScreenRef? = nil
    ) -> FakeResponse where A.Result: Encodable {
        var body = outcome(action, "ok")
        body["result"] = (try? JSONValue(encoding: result)) ?? .object([:])
        var effects: [String: JSONValue] = [:]
        if !invalidate.isEmpty { effects["invalidate"] = try? JSONValue(encoding: invalidate) }
        if let navigate { effects["navigate"] = try? JSONValue(encoding: navigate) }
        if !effects.isEmpty { body["effects"] = .object(effects) }
        return FakeResponse(status: 200, body: .object(body))
    }

    /// One of an action's declared errors.
    public static func error<A: ActionDescriptor>(_ action: A.Type, _ error: A.DeclaredError) -> FakeResponse {
        var body = outcome(action, "error")
        var json: [String: JSONValue] = ["code": .string(error.code)]
        if let details = error.details { json["details"] = details }
        body["error"] = .object(json)
        return FakeResponse(status: 200, body: .object(body))
    }

    private static func outcome<A: ActionDescriptor>(_ action: A.Type, _ status: String) -> [String: JSONValue] {
        ["protocol": .int(ClientCompose.protocolVersion), "action": .string(A.action), "version": .int(A.version), "status": .string(status)]
    }
}

/// An island in a `FakeResponse.screen`.
public struct FakeIsland: Sendable {
    let json: JSONValue

    /// An island with props, typed by its generated props type, and its strings (spec §4.7).
    public static func island<Props: IslandProps & Encodable>(
        _ key: String,
        _ props: Props,
        strings: [String: StringTemplate]? = nil
    ) -> FakeIsland {
        var json: [String: JSONValue] = [
            "key": .string(key),
            "type": .string(Props.islandType),
            "version": .int(Props.islandVersion),
            "status": .string("ok"),
            "props": (try? JSONValue(encoding: props)) ?? .object([:]),
        ]
        if let strings { json["strings"] = try? JSONValue(encoding: strings) }
        return FakeIsland(json: .object(json))
    }

    /// An island that failed on the composer, e.g. `.islandError("posts", PostGridV1.self, code: "timeout")`.
    public static func islandError<Props: IslandProps>(_ key: String, _ props: Props.Type, code: String) -> FakeIsland {
        FakeIsland(json: .object([
            "key": .string(key),
            "type": .string(Props.islandType),
            "version": .int(Props.islandVersion),
            "status": .string("error"),
            "error": .object(["code": .string(code)]),
        ]))
    }
}

private extension JSONValue {
    var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}
