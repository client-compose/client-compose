// What this web app can render. Props types come from islands.generated.ts (codegen).

import { ReactIslandRegistry } from "@client-compose/react";
import { useState } from "react";

import {
  FollowButtonV1,
  PostGridV1,
  ProfileHeaderV1,
  ProfileHeaderV2,
} from "./islands.generated.ts";

function ProfileHeader(props: { displayName: string; avatarUrl: string; badge?: string }) {
  return (
    <header className="profile-header">
      <img src={props.avatarUrl} alt="" width={64} height={64} />
      <h1>{props.displayName}</h1>
      {props.badge && <span className="badge">{props.badge}</span>}
    </header>
  );
}

function FollowButton({ userId, isFollowing }: FollowButtonV1) {
  // Interactivity stays on the client: call your follow API directly here.
  const [following, setFollowing] = useState(isFollowing);
  return (
    <button className="follow" data-user={userId} onClick={() => setFollowing(!following)}>
      {following ? "Following" : "Follow"}
    </button>
  );
}

function PostGrid({ posts }: PostGridV1) {
  return (
    <section className="post-grid">
      {posts.map((post) => (
        <img key={post.id} src={post.thumbnailUrl} alt="" />
      ))}
    </section>
  );
}

export const registry = new ReactIslandRegistry()
  .registerComponent(ProfileHeaderV1, ProfileHeader)
  .registerComponent(ProfileHeaderV2, ProfileHeader)
  .registerComponent(FollowButtonV1, FollowButton)
  .registerComponent(PostGridV1, PostGrid);
