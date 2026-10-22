import type { NextConfig } from "next";

const composer = process.env.COMPOSER_URL ?? "http://localhost:8080";

const config: NextConfig = {
  // In this repo the Client Compose packages are TypeScript sources; from npm you don't need this.
  transpilePackages: [
    "@client-compose/react",
    "@client-compose/client",
    "@client-compose/protocol",
  ],
  // Browser-side screen requests (the /ssr route's client navigation) go through Next to the composer.
  rewrites: async () => [
    { source: "/screens/:screen", destination: `${composer}/screens/:screen` },
  ],
};

export default config;
