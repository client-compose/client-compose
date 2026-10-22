#if canImport(SwiftUI)
import ClientCompose
import SwiftUI

/// How an action call ended (UI-3): its result, one of its declared errors, or a failure (no
/// connection, `unauthenticated`, or an error code this app version doesn't know).
public enum ActionResult<Result, DeclaredError> {
    case ok(Result, ActionEffects)
    case error(DeclaredError)
    case failed(Error)

    /// The declared error, if the call ended with one.
    public var declaredError: DeclaredError? {
        if case .error(let error) = self { return error }
        return nil
    }

    /// Whether the call failed: show a generic "something went wrong".
    public var failed: Bool {
        if case .failed = self { return true }
        return false
    }
}

/// Runs one action from a view, with its pending state and last result. Get one with `@ComposeAction`.
@MainActor
public final class ActionModel<A: ActionDescriptor>: ObservableObject {
    /// A call is in flight.
    @Published public private(set) var pending = false
    /// How the last call ended.
    @Published public private(set) var last: ActionResult<A.Result, A.DeclaredError>?

    var client: ComposeClient?

    /// In views, use `@ComposeAction`, which supplies the client from the environment. Pass one
    /// here to use the model elsewhere, e.g. in tests or a UIKit controller.
    public nonisolated init(client: ComposeClient? = nil) {
        self.client = client
    }

    /// Performs the action. It never throws: failures are a result too.
    ///
    /// - Parameter idempotencyKey: One per user intent. Pass the same key to retry it.
    @discardableResult
    public func run(_ input: A.Input, idempotencyKey: String = UUID().uuidString) async -> ActionResult<A.Result, A.DeclaredError> {
        pending = true
        defer { pending = false }
        let result: ActionResult<A.Result, A.DeclaredError>
        if let client {
            do {
                switch try await client.perform(A.self, input, idempotencyKey: idempotencyKey) {
                case .ok(let value, let effects): result = .ok(value, effects)
                case .error(let error): result = .error(error)
                }
            } catch {
                result = .failed(error)
            }
        } else {
            result = .failed(MissingClient())
        }
        last = result
        return result
    }

    /// Forget the last result, e.g. when the form changes.
    public func reset() { last = nil }
}

/// An action for a view, using the client from `.compose(client:registry:)`:
///
///     struct FollowButton: View {
///         @ComposeAction(FollowUserV1.self) private var follow
///
///         var body: some View {
///             Button("Follow") { Task { await follow.run(.init(userId: userId)) } }
///                 .disabled(follow.pending)
///             if follow.last?.declaredError == .blocked { Text("You can't follow this person") }
///             if follow.last?.failed == true { Text("Something went wrong") }
///         }
///     }
@MainActor
@propertyWrapper
public struct ComposeAction<A: ActionDescriptor> {
    @Environment(\.composeClient) private var client
    @StateObject private var model = ActionModel<A>()

    public init(_ action: A.Type) {}

    public var wrappedValue: ActionModel<A> { model }

    public func update() {
        model.client = client
    }
}

// SwiftUI calls update on the main thread.
#if compiler(>=6)
extension ComposeAction: @preconcurrency DynamicProperty {}
#else
extension ComposeAction: DynamicProperty {}
#endif
#endif
