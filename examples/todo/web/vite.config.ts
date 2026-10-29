import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const composer = process.env.COMPOSER_URL ?? "http://localhost:8080";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Use the Client Compose packages straight from this repo. In your own app, install them from npm instead.
    alias: {
      "@client-compose/react": repo("clients/typescript/react/src/index.ts"),
      "@client-compose/client/proxy": repo("clients/typescript/core/src/proxy.ts"),
      "@client-compose/client": repo("clients/typescript/core/src/index.ts"),
      "@client-compose/protocol": repo("shared/typescript/protocol/src/index.ts"),
    },
    // The aliased sources live outside this project; make sure they share this app's React.
    dedupe: ["react", "react-dom"],
  },
  server: {
    // The composer: either one in ../composer-go or ../composer-ts, on :8080 unless COMPOSER_URL
    // says otherwise. The app asks this server, so it needs no CORS.
    proxy: {
      "/screens": composer,
      "/actions": composer,
      "/strings": composer,
    },
  },
});
