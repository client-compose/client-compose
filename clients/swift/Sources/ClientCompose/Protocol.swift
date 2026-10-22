import Foundation

/// Wire types for Client Compose protocol v0. See spec/PROTOCOL.md.
public enum ClientCompose {
    public static let protocolVersion = 0
}

public struct ClientContext: Encodable, Sendable {
    public var platform: String
    public var appVersion: String
    public var locale: String?
    /// Extra targeting fields (e.g. `osVersion`), sent alongside the known ones.
    public var extra: [String: String]

    public init(platform: String = "ios", appVersion: String, locale: String? = nil, extra: [String: String] = [:]) {
        self.platform = platform
        self.appVersion = appVersion
        self.locale = locale
        self.extra = extra
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        for (key, value) in extra { try container.encode(value, forKey: Key(key)) }
        try container.encode(platform, forKey: Key("platform"))
        try container.encode(appVersion, forKey: Key("appVersion"))
        try container.encodeIfPresent(locale, forKey: Key("locale"))
    }
}

public struct ScreenRequest: Encodable, Sendable {
    public let `protocol`: Int
    public let screen: String
    public let params: [String: String]
    public let client: ClientContext
    /// Capabilities: island type -> supported versions.
    public let islands: [String: [Int]]
}

public struct IslandError: Decodable, Sendable, Equatable {
    public let code: String
    public let message: String?
    public let retryable: Bool?
}

public struct IslandEntry: Decodable, Sendable {
    public let key: String
    public let type: String
    public let version: Int
    /// Kept as a string so future statuses decode (and are then skipped, spec §4.4).
    public let status: String
    public let props: JSONValue?
    public let error: IslandError?
}

public struct CacheHint: Decodable, Sendable {
    public let maxAge: Int
}

/// Describes the screen as a whole: e.g. the navigation title (spec §4).
public struct ScreenMeta: Decodable, Sendable, Equatable {
    public let title: String?
    public let description: String?
    /// Absolute URL.
    public let image: String?
}

public struct ScreenResponse: Decodable, Sendable {
    public let `protocol`: Int
    public let screen: String
    public let islands: [IslandEntry]
    public let meta: ScreenMeta?
    public let cache: CacheHint?
}

/// Refers to screens: those with this id whose params include all of `params` (spec §5.3).
public struct ScreenRef: Codable, Sendable, Hashable {
    public let screen: String
    public let params: [String: String]

    public init(screen: String, params: [String: String] = [:]) {
        self.screen = screen
        self.params = params
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        screen = try c.decode(String.self, forKey: .screen)
        params = try c.decodeIfPresent([String: String].self, forKey: .params) ?? [:]
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(screen, forKey: .screen)
        if !params.isEmpty { try c.encode(params, forKey: .params) }
    }

    private enum CodingKeys: String, CodingKey { case screen, params }

    /// Whether this reference matches a screen with this id and params.
    public func matches(screen: String, params: [String: String]) -> Bool {
        screen == self.screen && self.params.allSatisfy { params[$0.key] == $0.value }
    }
}

/// What a successful action changed (spec §5.3). Unknown effects are ignored.
public struct ActionEffects: Decodable, Sendable, Equatable {
    /// Screens whose content may have changed. The client drops them from its cache and reloads the
    /// ones on show.
    public let invalidate: [ScreenRef]
    /// A screen to show next. The client passes it to your navigation handler.
    public let navigate: ScreenRef?

    public init(invalidate: [ScreenRef] = [], navigate: ScreenRef? = nil) {
        self.invalidate = invalidate
        self.navigate = navigate
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        invalidate = try c.decodeIfPresent([ScreenRef].self, forKey: .invalidate) ?? []
        navigate = try c.decodeIfPresent(ScreenRef.self, forKey: .navigate)
    }

    private enum CodingKeys: String, CodingKey { case invalidate, navigate }
}

/// The body of a failed screen or action request (spec §4.3).
struct ErrorBody: Decodable {
    struct Detail: Decodable {
        let code: String?
    }

    let error: Detail?

    /// The protocol error code in a response body, if it has one.
    static func code(in data: Data) -> String? {
        (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error?.code
    }
}
