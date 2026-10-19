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

public struct ScreenResponse: Decodable, Sendable {
    public let `protocol`: Int
    public let screen: String
    public let islands: [IslandEntry]
    public let cache: CacheHint?
}
