import type { ClientComposeConfig } from "@client-compose/react";
import { Platform } from "react-native";

import { registry } from "./registry";

// The composer: either one in ../composer-go or ../composer-ts. The Android emulator reaches the
// host machine at 10.0.2.2.
const localComposer = Platform.select({
  android: "http://10.0.2.2:8080",
  default: "http://localhost:8080",
});

/** Who the app is, and where its composer is. It asks for everything in the device's language. */
export const config: ClientComposeConfig = {
  registry,
  baseUrl: process.env.EXPO_PUBLIC_COMPOSER_URL ?? localComposer,
  client: {
    platform: Platform.OS,
    appVersion: "1.0.0",
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
  },
  onSkipped: (entry, reason) => console.warn(`skipped island ${entry.key}: ${reason}`),
  onRenderError: (key, error) => console.error(`island ${key} failed to render`, error),
};
