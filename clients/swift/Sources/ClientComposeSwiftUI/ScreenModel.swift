#if canImport(SwiftUI)
import ClientCompose
import SwiftUI

/// A screen's state (UI-2): its islands, its response and meta, and whether it's loading. Use it
/// for layouts `ComposedScreen` doesn't give you, such as a `List` with pull to refresh:
///
///     @StateObject private var profile: ScreenModel
///
///     List(profile.islands) { $0.output }
///         .refreshable { await profile.reload() }
///         .task { await profile.load() }
///
/// It takes an action's changes and updates by itself, and reloads when an action invalidates its
/// screen, or changes it in a way it can't show without reloading (spec §5.3).
@MainActor
public final class ScreenModel: ObservableObject {
    public let screen: String
    public let params: [String: String]

    /// The islands to show, in order.
    @Published public private(set) var islands: [PlannedIsland<AnyView>] = []
    /// The last response, if there's been one.
    @Published public private(set) var response: ScreenResponse?
    /// The last request's error. With a response, a reload failed and the earlier islands are shown.
    @Published public private(set) var error: Error?
    /// A request is in flight.
    @Published public private(set) var refreshing = false

    private let client: ComposeClient
    private let registry: IslandRegistry<AnyView>
    private let onSkipped: ((IslandEntry, SkipReason) -> Void)?
    private var watch: ScreenWatch?

    public init(
        screen: String,
        params: [String: String] = [:],
        client: ComposeClient,
        registry: IslandRegistry<AnyView>,
        onSkipped: ((IslandEntry, SkipReason) -> Void)? = nil
    ) {
        self.screen = screen
        self.params = params
        self.client = client
        self.registry = registry
        self.onSkipped = onSkipped
    }

    /// Loading until the first response; failed only if there's nothing to show.
    public enum Status: Equatable {
        case loading, ready, failed
    }

    public var status: Status {
        if response != nil { return .ready }
        return error == nil ? .loading : .failed
    }

    /// The screen as a whole: e.g. its title.
    public var meta: ScreenMeta? { response?.meta }

    /// Fetch the screen, from the client's cache if it's fresh, and start reloading it when actions
    /// invalidate it. Call it from `.task`, so leaving the screen cancels it.
    public func load() async {
        if watch == nil {
            watch = await client.watch(
                screen: screen,
                params: params,
                onEffects: { [weak self] batch in self?.apply(batch) },
                onInvalidate: { [weak self] in Task { await self?.reload() } }
            )
        }
        await fetch(reload: false)
    }

    /// Fetch the screen again, bypassing the cache. The current islands stay until the new ones arrive.
    public func reload() async {
        await fetch(reload: true)
    }

    /// Shows the screen as an action left it, or reloads it when the changes can't be shown on it.
    private func apply(_ batch: EffectsBatch) {
        guard let response else { return }
        guard let changed = batch.apply(to: response, params: params) else {
            Task { await reload() }
            return
        }
        self.response = changed
        islands = registry.plan(changed, onSkipped: onSkipped)
    }

    private func fetch(reload: Bool) async {
        refreshing = true
        defer { refreshing = false }
        do {
            let response = try await client.screen(screen, params: params, islands: registry.capabilities, reload: reload)
            guard !Task.isCancelled else { return }
            self.response = response
            islands = registry.plan(response, onSkipped: onSkipped)
            error = nil
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error
        }
    }
}
#endif
