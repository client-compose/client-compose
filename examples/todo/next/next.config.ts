import type { NextConfig } from "next";

const composer = process.env.COMPOSER_URL ?? "http://localhost:8080";

const config: NextConfig = {
  // In this repo the Client Compose packages are TypeScript sources; from npm you don't need this.
  transpilePackages: [
    "@client-compose/react",
    "@client-compose/client",
    "@client-compose/protocol",
  ],
  // Pages are rendered on the server. What the browser sends itself, the islands' actions, goes
  // through Next to the composer, so it needs no CORS.
  rewrites: async () => [
    { source: "/actions/:action", destination: `${composer}/actions/:action` },
  ],
};

export default config;
