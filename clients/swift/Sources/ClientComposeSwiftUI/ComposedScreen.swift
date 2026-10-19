#if canImport(SwiftUI)
import ClientCompose
import SwiftUI

/// Fetches a screen and renders its islands top to bottom.
///
/// This is a convenience for the common case. For custom layouts, call
/// `ScreenClient.fetch` and `IslandRegistry.plan` yourself.
@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
public struct ComposedScreen<Loading: View, Failure: View>: View {
    private enum Phase {
        case loading
        case loaded([PlannedIsland<AnyView>])
        case failed(Error)
    }

    private let request: ScreenRequest
    private let registry: IslandRegistry<AnyView>
    private let client: ScreenClient
    private let onSkipped: ((IslandEntry, SkipReason) -> Void)?
    private let loading: () -> Loading
    private let failure: (Error, @escaping () -> Void) -> Failure

    @State private var phase: Phase = .loading

    public init(
        screen: String,
        params: [String: String] = [:],
        context: ClientContext,
        registry: IslandRegistry<AnyView>,
        client: ScreenClient,
        onSkipped: ((IslandEntry, SkipReason) -> Void)? = nil,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (_ error: Error, _ retry: @escaping () -> Void) -> Failure
    ) {
        self.request = registry.request(screen: screen, client: context, params: params)
        self.registry = registry
        self.client = client
        self.onSkipped = onSkipped
        self.loading = loading
        self.failure = failure
    }

    public var body: some View {
        Group {
            switch phase {
            case .loading:
                loading()
            case .loaded(let islands):
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(islands) { $0.output }
                    }
                }
            case .failed(let error):
                failure(error) { Task { await load() } }
            }
        }
        .task(id: request.screen + request.params.description) { await load() }
    }

    @MainActor
    private func load() async {
        phase = .loading
        do {
            let response = try await client.fetch(request)
            phase = .loaded(registry.plan(response, onSkipped: onSkipped))
        } catch {
            phase = .failed(error)
        }
    }
}
#endif
