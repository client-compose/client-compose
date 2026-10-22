#if canImport(SwiftUI)
import ClientCompose
import SwiftUI

private struct ComposeClientKey: EnvironmentKey {
    static let defaultValue: ComposeClient? = nil
}

private struct IslandRegistryKey: EnvironmentKey {
    static let defaultValue = IslandRegistry<AnyView>()
}

extension EnvironmentValues {
    /// The client `ComposedScreen` and `@ComposeAction` use. Set it with `.compose(client:registry:)`.
    public var composeClient: ComposeClient? {
        get { self[ComposeClientKey.self] }
        set { self[ComposeClientKey.self] = newValue }
    }

    /// The islands `ComposedScreen` can render. Set it with `.compose(client:registry:)`.
    public var islandRegistry: IslandRegistry<AnyView> {
        get { self[IslandRegistryKey.self] }
        set { self[IslandRegistryKey.self] = newValue }
    }
}

extension View {
    /// Gives every `ComposedScreen` and `@ComposeAction` below this view the client and registry:
    ///
    ///     WindowGroup {
    ///         RootView().compose(client: client, registry: Islands.registry)
    ///     }
    public func compose(client: ComposeClient, registry: IslandRegistry<AnyView>) -> some View {
        environment(\.composeClient, client).environment(\.islandRegistry, registry)
    }
}
#endif
