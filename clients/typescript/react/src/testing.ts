// Test helpers for React and React Native apps built on Client Compose. Pairs the fake composer
// from `@client-compose/client/testing` with a provider config that records navigation and
// invalidation, so a test can render an island the way the app does:
//
//     const { config, gateway, navigations } = createTestConfig({
//       registry,
//       handlers: { actions: { follow: () => actionOk(FollowUserV1, { followers: 8 }) } },
//     });
//     render(<ClientComposeProvider config={config}><FollowButton userId="u1" /></ClientComposeProvider>);
//
// No test framework or renderer of its own: use it with React Testing Library, React Native
// Testing Library, or anything else.

import {
  createFakeGateway,
  type FakeGateway,
  type FakeGatewayHandlers,
} from "@client-compose/client/testing";
import type { ScreenRef } from "@client-compose/protocol";

import type { ClientComposeConfig } from "./config.ts";

export * from "@client-compose/client/testing";

export interface TestConfigOptions extends Partial<Omit<ClientComposeConfig, "registry">> {
  registry: ClientComposeConfig["registry"];
  /** How the fake composer answers. */
  handlers?: FakeGatewayHandlers;
}

export interface TestConfig {
  /** For `<ClientComposeProvider>`. Its `fetch` is the fake composer's (unless you passed one). */
  config: ClientComposeConfig;
  gateway: FakeGateway;
  /** Where actions' `navigate` effects asked to go, in order. */
  navigations: ScreenRef[];
  /** What actions' `invalidate` effects named, one list per action. */
  invalidations: ScreenRef[][];
}

/**
 * A provider config for tests: a fake composer at `http://composer.test`, an English web client
 * (override with `client`), caching off, and effects recorded. Your own `onNavigate` and
 * `onInvalidate` still run.
 */
export function createTestConfig(options: TestConfigOptions): TestConfig {
  const { handlers, ...overrides } = options;
  const gateway = createFakeGateway(handlers);
  const navigations: ScreenRef[] = [];
  const invalidations: ScreenRef[][] = [];
  const config: ClientComposeConfig = {
    baseUrl: "http://composer.test",
    client: { platform: "web", appVersion: "test", locale: "en" },
    fetch: gateway.fetch,
    cache: false,
    ...overrides,
    onNavigate: (ref) => {
      navigations.push(ref);
      overrides.onNavigate?.(ref);
    },
    onInvalidate: (refs) => {
      invalidations.push(refs);
      overrides.onInvalidate?.(refs);
    },
  };
  return { config, gateway, navigations, invalidations };
}
