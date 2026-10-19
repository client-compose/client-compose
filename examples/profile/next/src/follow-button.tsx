"use client";

import { useState } from "react";
import type { FollowButtonV1 } from "./islands.generated";

/** A Client Component island: interactivity stays on the client. */
export function FollowButton({ userId, isFollowing }: FollowButtonV1) {
  const [following, setFollowing] = useState(isFollowing);
  return (
    <button className="follow" data-user={userId} onClick={() => setFollowing(!following)}>
      {following ? "Following" : "Follow"}
    </button>
  );
}
