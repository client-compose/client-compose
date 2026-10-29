// The composer, from the server: every page asks it for its screen and words, in the language the
// browser asks for (Accept-Language).
import { preferredLocale, type ScreenConfig, serverComposer } from "@client-compose/react/server";
import { headers } from "next/headers";

import { registry } from "./registry";

const COMPOSER_URL = process.env.COMPOSER_URL ?? "http://localhost:8080";

const client = { platform: "web", appVersion: "1.0.0" };

export const screenConfig: ScreenConfig = {
  registry,
  baseUrl: COMPOSER_URL,
  client,
  // Screens change with every action: never keep one in Next's fetch cache.
  requestInit: { cache: "no-store" },
  onSkipped: (entry, reason) => console.warn(`skipped island ${entry.key}: ${reason}`),
  onRenderError: (key, error) => console.error(`island ${key} failed to render`, error),
};

/** Who's asking: this app, in the browser's language. */
async function requestClient() {
  const requestHeaders = await headers();

  return { ...client, locale: preferredLocale(requestHeaders.get("accept-language")) };
}

/** Each request's screens and strings, fetched once however many components ask. */
export const composer = serverComposer(screenConfig, { client: requestClient });
