// Minimal composer on node:http.
//   node composers/typescript/node-http/example.ts
//   curl -s localhost:4000/screens/profile -d '{"protocol":0,"screen":"profile","params":{"userId":"u_1"},"client":{"platform":"web","appVersion":"1.0.0"},"islands":{"profile-header":[1,2],"post-grid":[1]}}'

import { createServer } from "node:http";
import { createComposer, defineIsland, defineScreen } from "@client-compose/composer";
import { createRequestListener } from "./src/index.ts";

// Stand-ins for your real backend services.
const users = {
  get: async (id: string) => ({ id, name: "Ada Lovelace", avatar: `https://example.com/avatars/${id}.png`, pro: true }),
};
const posts = {
  recent: async (userId: string) => [{ id: "p1", thumb: `https://example.com/${userId}/p1.jpg` }],
};

type Ctx = { users: typeof users; posts: typeof posts };

const profileHeaderV1 = defineIsland<{ displayName: string; avatarUrl: string }, Ctx>({
  type: "profile-header",
  version: 1,
  resolve: async ({ params, ctx }) => {
    const u = await ctx.users.get(params.userId);
    return { displayName: u.name, avatarUrl: u.avatar };
  },
});

const profileHeaderV2 = defineIsland<{ userId: string; displayName: string; avatarUrl: string; badge?: string }, Ctx>({
  type: "profile-header",
  version: 2,
  resolve: async ({ params, ctx }) => {
    const u = await ctx.users.get(params.userId);
    return { userId: u.id, displayName: u.name, avatarUrl: u.avatar, badge: u.pro ? "PRO" : undefined };
  },
});

const postGridV1 = defineIsland<{ posts: { id: string; thumbnailUrl: string }[] }, Ctx>({
  type: "post-grid",
  version: 1,
  resolve: async ({ params, ctx }) => ({
    posts: (await ctx.posts.recent(params.userId)).map((p) => ({ id: p.id, thumbnailUrl: p.thumb })),
  }),
});

const profile = defineScreen<Ctx>({
  id: "profile",
  cacheMaxAge: 30,
  layout: () => [
    { key: "header", island: [profileHeaderV1, profileHeaderV2], required: true },
    { key: "posts", island: [postGridV1], timeoutMs: 500 },
  ],
});

const compose = createComposer([profile], {
  onIslandError: (key, type, err) => console.error(`island ${key} (${type}) failed`, err),
});

createServer(createRequestListener(compose, () => ({ users, posts }))).listen(4000, () =>
  console.log("composer listening on http://localhost:4000"),
);
