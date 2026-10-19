// What this app can render. Props types come from islands.generated.ts (codegen).

import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { ReactIslandRegistry } from "@client-compose/react";
import { FollowButtonV1, PostGridV1, ProfileHeaderV1, ProfileHeaderV2 } from "./islands.generated";

function ProfileHeader(props: { displayName: string; avatarUrl: string; badge?: string }) {
  return (
    <View style={styles.header}>
      <Image source={{ uri: props.avatarUrl }} style={styles.avatar} />
      <Text style={styles.name}>{props.displayName}</Text>
      {props.badge ? <Text style={styles.badge}>{props.badge}</Text> : null}
    </View>
  );
}

function FollowButton({ isFollowing }: FollowButtonV1) {
  // Interactivity stays on the client: call your follow API directly here.
  const [following, setFollowing] = useState(isFollowing);
  return (
    <Pressable style={styles.follow} onPress={() => setFollowing(!following)}>
      <Text style={styles.followText}>{following ? "Following" : "Follow"}</Text>
    </Pressable>
  );
}

function PostGrid({ posts }: PostGridV1) {
  return (
    <View style={styles.grid}>
      {posts.map((post) => (
        <Image key={post.id} source={{ uri: post.thumbnailUrl }} style={styles.thumb} />
      ))}
    </View>
  );
}

export const registry = new ReactIslandRegistry()
  .registerComponent(ProfileHeaderV1, ProfileHeader)
  .registerComponent(ProfileHeaderV2, ProfileHeader)
  .registerComponent(FollowButtonV1, FollowButton)
  .registerComponent(PostGridV1, PostGrid);

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ddd" },
  name: { fontSize: 22, fontWeight: "700" },
  badge: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2952cc",
    backgroundColor: "#e8efff",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: "hidden",
  },
  follow: { marginHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: "#2952cc", alignItems: "center" },
  followText: { color: "#fff", fontWeight: "600" },
  // flex-start so each thumbnail's height comes from aspectRatio rather than stretching to the row.
  grid: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 2, marginTop: 16 },
  thumb: { width: "33%", aspectRatio: 1, backgroundColor: "#ddd" },
});
