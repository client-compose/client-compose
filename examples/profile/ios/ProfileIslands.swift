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

// MARK: - Screen

struct ProfileScreen: View {
    let userId: String

    var body: some View {
        ComposedScreen(
            screen: "profile",
            params: ["userId": userId],
            context: ClientContext(
                appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0",
                locale: Locale.current.identifier
            ),
            registry: Islands.registry,
            client: ScreenClient(
                baseURL: URL(string: "https://api.example.com/compose")!,
                headers: ["Authorization": "Bearer …"]
            ),
            onSkipped: { entry, reason in print("skipped island \(entry.key): \(reason)") },
            loading: { ProgressView() },
            failure: { _, retry in
                VStack(spacing: 12) {
                    Text("Couldn't load this profile")
                    Button("Try again", action: retry)
                }
            }
        )
        .navigationTitle("Profile")
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
    @State private var isFollowing: Bool

    init(userId: String, isFollowing: Bool) {
        self.userId = userId
        _isFollowing = State(initialValue: isFollowing)
    }

    var body: some View {
        Button(isFollowing ? "Following" : "Follow") {
            // Interactivity stays on the client: call your follow API directly here.
            isFollowing.toggle()
        }
        .buttonStyle(.borderedProminent)
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
