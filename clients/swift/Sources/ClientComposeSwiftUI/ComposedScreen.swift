#if canImport(SwiftUI)
import ClientCompose
import SwiftUI

/// Fetches a screen and shows its islands in order (UI-1), with the client and registry from
/// `.compose(client:registry:)`:
///
///     ComposedScreen("profile", params: ["userId": userId])
///
///     ComposedScreen("profile", params: ["userId": userId]) { islands in
///         List(islands) { $0.output }
///     } loading: {
///         ProgressView()
///     } failure: { error, retry in
///         if (error as? ScreenError)?.isNotFound == true {
///             Text("This profile doesn't exist")
///         } else {
///             Button("Try again", action: retry)
///         }
///     }
///
/// The screen's title (its meta) becomes the navigation title. It reloads when an action changes it,
/// and leaving it cancels its request.
@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
public struct ComposedScreen<Content: View, Loading: View, Failure: View>: View {
    private let screen: String
    private let params: [String: String]
    private let content: ([PlannedIsland<AnyView>]) -> Content
    private let loading: () -> Loading
    private let failure: (Error, @escaping () -> Void) -> Failure

    @Environment(\.composeClient) private var client
    @Environment(\.islandRegistry) private var registry

    public init(
        _ screen: String,
        params: [String: String] = [:],
        @ViewBuilder content: @escaping ([PlannedIsland<AnyView>]) -> Content,
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (_ error: Error, _ retry: @escaping () -> Void) -> Failure
    ) {
        self.screen = screen
        self.params = params
        self.content = content
        self.loading = loading
        self.failure = failure
    }

    public var body: some View {
        if let client {
            ScreenHost(
                model: ScreenModel(screen: screen, params: params, client: client, registry: registry),
                content: content,
                loading: loading,
                failure: failure
            )
            .id(screen + "?" + params.sorted { $0.key < $1.key }.description)
        } else {
            failure(MissingClient(), {})
        }
    }
}

/// `ComposedScreen` was used without `.compose(client:registry:)` above it.
public struct MissingClient: Error, CustomStringConvertible {
    public var description: String { "ComposedScreen needs .compose(client:registry:) above it" }
}

@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
extension ComposedScreen where Content == DefaultIslands {
    /// The islands top to bottom in a scroll view.
    public init(
        _ screen: String,
        params: [String: String] = [:],
        @ViewBuilder loading: @escaping () -> Loading,
        @ViewBuilder failure: @escaping (_ error: Error, _ retry: @escaping () -> Void) -> Failure
    ) {
        self.init(screen, params: params, content: { DefaultIslands(islands: $0) }, loading: loading, failure: failure)
    }
}

@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
extension ComposedScreen where Content == DefaultIslands, Loading == ProgressView<EmptyView, EmptyView>, Failure == DefaultFailure {
    /// The islands top to bottom in a scroll view, a spinner while loading, and a retry button.
    public init(_ screen: String, params: [String: String] = [:]) {
        self.init(
            screen,
            params: params,
            content: { DefaultIslands(islands: $0) },
            loading: { ProgressView() },
            failure: { DefaultFailure(retry: $1) }
        )
    }
}

/// The islands top to bottom in a scroll view.
public struct DefaultIslands: View {
    let islands: [PlannedIsland<AnyView>]

    public var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(islands) { $0.output }
            }
        }
    }
}

/// A retry button.
public struct DefaultFailure: View {
    let retry: () -> Void

    public var body: some View {
        Button(action: retry) { Image(systemName: "arrow.clockwise") }
            .accessibilityLabel(Text("Try again"))
    }
}

@available(iOS 15.0, macOS 12.0, tvOS 15.0, watchOS 8.0, *)
private struct ScreenHost<Content: View, Loading: View, Failure: View>: View {
    @StateObject var model: ScreenModel
    let content: ([PlannedIsland<AnyView>]) -> Content
    let loading: () -> Loading
    let failure: (Error, @escaping () -> Void) -> Failure

    init(
        model: @autoclosure @escaping () -> ScreenModel,
        content: @escaping ([PlannedIsland<AnyView>]) -> Content,
        loading: @escaping () -> Loading,
        failure: @escaping (Error, @escaping () -> Void) -> Failure
    ) {
        _model = StateObject(wrappedValue: model())
        self.content = content
        self.loading = loading
        self.failure = failure
    }

    var body: some View {
        Group {
            switch model.status {
            case .loading:
                loading()
            case .failed:
                failure(model.error ?? MissingClient()) { Task { await model.reload() } }
            case .ready:
                titled(content(model.islands))
            }
        }
        .task { await model.load() }
    }

    @ViewBuilder
    private func titled(_ view: Content) -> some View {
        #if os(macOS) || os(iOS) || os(tvOS) || os(watchOS) || os(visionOS)
        if let title = model.meta?.title {
            view.navigationTitle(title)
        } else {
            view
        }
        #else
        view
        #endif
    }
}
#endif
