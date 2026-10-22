// iOS side of the profile example: island props, SwiftUI views, registry and screen.
// Add the package (repo URL) in Xcode and link ClientCompose + ClientComposeSwiftUI.

import ClientCompose
import ClientComposeSwiftUI
import SwiftUI

// MARK: - Registry: what this app version can render
// ProfileHeaderV1, ProfileHeaderV2, FollowButtonV1 and PostGridV1 come from
// Islands.generated.swift, generated from ../islands (see ../client-compose.codegen.json).

enum Islands {
    static let registry: IslandRegistry<AnyView> = {
        IslandRegistry<AnyView>()
            .register(ProfileHeaderV1.self) { props, _ in
                AnyView(ProfileHeader(name: props.displayName, avatarURL: props.avatarUrl, badge: nil))
            }
            .register(ProfileHeaderV2.self) { props, _ in
                AnyView(ProfileHeader(name: props.displayName, avatarURL: props.avatarUrl, badge: props.badge))
            }
            .register(FollowButtonV1.self) { props, _ in
                AnyView(FollowButton(userId: props.userId, isFollowing: props.isFollowing))
            }
            .register(PostGridV1.self) { props, _ in
                AnyView(PostGrid(posts: props.posts))
            }
    }()
}

// MARK: - Client: one for the app, given to every screen below the root

enum Compose {
    static let client = ComposeClient(
        baseURL: URL(string: "https://api.example.com/compose")!,
        context: ClientContext(
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
            locale: Locale.current.identifier
        ),
        headers: { ["Authorization": "Bearer \(await Session.shared.token())"] },
        onNavigate: { ref in Router.shared.show(ref) }
    )
}

// In your App: RootView().compose(client: Compose.client, registry: Islands.registry)

// MARK: - Screen

struct ProfileScreen: View {
    let userId: String

    var body: some View {
        // The screen's title comes from the composer; following someone reloads it by itself.
        ComposedScreen("profile", params: ["userId": userId]) {
            ProgressView()
        } failure: { error, retry in
            if (error as? ScreenError)?.isNotFound == true {
                Text("This profile doesn't exist")
            } else {
                VStack(spacing: 12) {
                    Text("Couldn't load this profile")
                    Button("Try again", action: retry)
                }
            }
        }
    }
}

// MARK: - Island views: entirely the app's business

struct ProfileHeader: View {
    let name: String
    let avatarURL: URL
    let badge: String?

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: avatarURL) { $0.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.2) }
                .frame(width: 64, height: 64)
                .clipShape(Circle())
            Text(name).font(.title2.bold())
            if let badge {
                Text(badge)
                    .font(.caption.bold())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Color.accentColor.opacity(0.15)))
            }
            Spacer()
        }
        .padding()
    }
}

struct FollowButton: View {
    let userId: String
    let isFollowing: Bool
    // FollowUserV1 is generated from ../actions/follow-user.v1.json.
    @ComposeAction(FollowUserV1.self) private var follow

    var body: some View {
        VStack(spacing: 8) {
            Button(isFollowing ? "Following" : "Follow") {
                // The composer says the profile changed, so it reloads with the new state.
                Task { await follow.run(.init(userId: userId, follow: !isFollowing)) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(follow.pending)

            if follow.last?.declaredError == .blocked {
                Text("You can't follow this person").font(.footnote)
            } else if follow.last?.failed == true {
                Text("Something went wrong").font(.footnote)
            }
        }
        .padding(.horizontal)
    }
}

struct PostGrid: View {
    let posts: [PostGridV1.Post]

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2), count: 3), spacing: 2) {
            ForEach(posts, id: \.id) { post in
                AsyncImage(url: post.thumbnailUrl) { $0.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.2) }
                    .aspectRatio(1, contentMode: .fill)
                    .clipped()
            }
        }
        .padding(.top)
    }
}

// MARK: - Stand-ins for your app's own session and navigation

actor Session {
    static let shared = Session()
    func token() -> String { "…" }
}

@MainActor
final class Router {
    static let shared = Router()
    func show(_ ref: ScreenRef) { print("navigate to \(ref.screen)") }
}
