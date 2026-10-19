// What this app can render. Imported by Server Components and Client Components alike, so it
// contains no hooks: ProfileHeader and PostGrid are plain components (Server Components when rendered
// from the /rsc route), and FollowButton is a Client Component from its own "use client" file.

import { ReactIslandRegistry } from "@client-compose/react";
import { FollowButton } from "./follow-button";
import { PostGridV1, ProfileHeaderV1, ProfileHeaderV2, FollowButtonV1 } from "./islands.generated";

function ProfileHeader(props: { displayName: string; avatarUrl: string; badge?: string }) {
  return (
    <header className="profile-header">
      <img src={props.avatarUrl} alt="" width={64} height={64} />
      <h1>{props.displayName}</h1>
      {props.badge && <span className="badge">{props.badge}</span>}
    </header>
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
