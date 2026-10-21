import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
    // The Go composer from ../composer-go (go run .) listens on :8080.
    proxy: { "/screens": "http://localhost:8080" },
  },
});
