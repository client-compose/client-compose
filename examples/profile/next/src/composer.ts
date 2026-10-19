import type { ScreenConfig } from "@client-compose/react";
import { registry } from "./islands";

const COMPOSER_URL = process.env.COMPOSER_URL ?? "http://localhost:8080";

/** Config for fetching screens on the server, as the signed-in user (stand-in for real auth). */
export function serverConfig(viewer: string): ScreenConfig {
  return {
    registry,
    baseUrl: COMPOSER_URL,
    client: { platform: "web", appVersion: "1.0.0" },
    headers: () => ({ "X-User-Id": viewer }),
    // Screens are personalised, so never share Next's fetch cache between users.
    requestInit: { cache: "no-store" },
    onSkipped: (entry, reason) => console.warn(`skipped island ${entry.key}: ${reason}`),
    onRenderError: (key, error) => console.error(`island ${key} failed to render`, error),
  };
}
