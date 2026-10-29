import type { ClientComposeConfig } from "@client-compose/react";

import { registry } from "./registry.ts";

/**
 * Who the app is, and where its composer is: this page's own server, which passes requests on to it
 * (vite.config.ts). It asks for everything in the browser's language.
 */
export const config: ClientComposeConfig = {
  registry,
  baseUrl: "",
  client: {
    platform: "web",
    appVersion: "1.0.0",
    locale: navigator.language,
  },
  onSkipped: (entry, reason) => console.warn(`skipped island ${entry.key}: ${reason}`),
  onRenderError: (key, error) => console.error(`island ${key} failed to render`, error),
};
