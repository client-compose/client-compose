import Foundation

public enum SkipReason: Sendable, Equatable {
    /// The client has no renderer for this island type/version.
    case unknownIsland
    /// The island has a status this client doesn't understand (e.g. a future `pending`).
    case unknownStatus
    /// The props didn't decode into the renderer's props type.
    case invalidProps(String)
}

/// Implemented by generated props types (see codegen/), tying a Swift type to its island
/// type and version.
public protocol IslandProps: Decodable {
    static var islandType: String { get }
    static var islandVersion: Int { get }
    /// Where its props hold entities (spec §2.1), for the client to apply an action's changes.
    static var islandEntities: [EntityPath] { get }
}

extension IslandProps {
    public static var islandEntities: [EntityPath] { [] }
}

public struct PlannedIsland<Output>: Identifiable {
    public let id: String
    public let output: Output
}

/// Maps island type + version to a renderer. `Output` is whatever your UI layer renders,
/// typically `AnyView` for SwiftUI or `UIView` for UIKit. Safe to share: registering takes a lock.
public final class IslandRegistry<Output>: @unchecked Sendable {
    private typealias AnyRenderer = (JSONValue, IslandEntry, PluralRules) throws -> Output
    private let lock = NSLock()
    private var _renderers: [String: [Int: AnyRenderer]] = [:]
    private var renderers: [String: [Int: AnyRenderer]] {
        lock.lock()
        defer { lock.unlock() }
        return _renderers
    }
    private let decoder: JSONDecoder
    private var _entities: [String: [EntityPath]] = [:]

    public init(decoder: JSONDecoder = JSONDecoder()) {
        self.decoder = decoder
    }

    /// Register a renderer for one version of an island.
    ///
    ///     registry.register("profile-header", version: 2) { (props: ProfileHeaderV2, _) in
    ///         AnyView(ProfileHeader(props: props))
    ///     }
    @discardableResult
    public func register<Props: Decodable>(
        _ type: String,
        version: Int,
        render: @escaping (Props, IslandEntry) -> Output
    ) -> Self {
        let decoder = self.decoder
        lock.lock()
        defer { lock.unlock() }
        _renderers[type, default: [:]][version] = { json, entry, _ in
            render(try json.decode(Props.self, using: decoder), entry)
        }
        return self
    }

    /// Register a renderer for a generated props type whose island declares strings: it receives
    /// them as `t`, in the screen's language (spec §4.7).
    ///
    ///     registry.register(RecipeListV1.self) { props, t, _ in AnyView(RecipeList(props: props, t: t)) }
    @discardableResult
    public func register<Props: IslandPropsWithStrings>(
        _ props: Props.Type,
        render: @escaping (Props, Props.Strings, IslandEntry) -> Output
    ) -> Self {
        let decoder = self.decoder
        lock.lock()
        defer { lock.unlock() }
        _entities["\(Props.islandType)@\(Props.islandVersion)"] = Props.islandEntities
        _renderers[Props.islandType, default: [:]][Props.islandVersion] = { json, entry, plurals in
            let t = Props.Strings(StringsTable(strings: entry.strings ?? [:], plurals: plurals))
            return render(try json.decode(Props.self, using: decoder), t, entry)
        }
        return self
    }

    /// Register a renderer for a generated props type; its island type and version come from `Props`.
    ///
    ///     registry.register(ProfileHeaderV2.self) { props, _ in AnyView(ProfileHeader(props: props)) }
    @discardableResult
    public func register<Props: IslandProps>(
        _ props: Props.Type,
        render: @escaping (Props, IslandEntry) -> Output
    ) -> Self {
        lock.lock()
        _entities["\(Props.islandType)@\(Props.islandVersion)"] = Props.islandEntities
        lock.unlock()
        return register(Props.islandType, version: Props.islandVersion, render: render)
    }

    /// What this client can render, sent with every request (spec §3).
    public var capabilities: [String: [Int]] {
        renderers.mapValues { $0.keys.sorted() }
    }

    /// What actions need to know about these islands: their versions, and where they hold entities.
    public var catalog: IslandCatalog {
        lock.lock()
        let entities = _entities
        lock.unlock()
        return IslandCatalog(capabilities: capabilities, entityPaths: entities)
    }

    public func request(
        screen: String,
        client: ClientContext,
        params: [String: String] = [:]
    ) -> ScreenRequest {
        ScreenRequest(
            protocol: ClientCompose.protocolVersion,
            screen: screen,
            params: params,
            client: client,
            islands: capabilities
        )
    }

    /// Turn a response into an ordered list of rendered islands (spec §4.4).
    ///
    /// - Parameters:
    ///   - onError: Render a fallback for an errored island. Return nil (the default) to omit it.
    ///   - onSkipped: Called for islands that can't be rendered. Useful for telemetry.
    public func plan(
        _ response: ScreenResponse,
        onError: ((IslandEntry, IslandError) -> Output?)? = nil,
        onSkipped: ((IslandEntry, SkipReason) -> Void)? = nil
    ) -> [PlannedIsland<Output>] {
        var out: [PlannedIsland<Output>] = []
        for entry in response.islands {
            switch entry.status {
            case "error":
                let error = entry.error ?? IslandError(code: "unknown", message: nil, retryable: nil)
                if let fallback = onError?(entry, error) {
                    out.append(PlannedIsland(id: entry.key, output: fallback))
                }
            case "ok":
                guard let render = renderers[entry.type]?[entry.version] else {
                    onSkipped?(entry, .unknownIsland)
                    continue
                }
                do {
                    let output = try render(entry.props ?? .object([:]), entry, response.plurals ?? [:])
                    out.append(PlannedIsland(id: entry.key, output: output))
                } catch {
                    onSkipped?(entry, .invalidProps(String(describing: error)))
                }
            default:
                onSkipped?(entry, .unknownStatus)
            }
        }
        return out
    }
}
