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
  island,
  islandResponse,
  screen,
  screenError,
} from "@client-compose/client/testing";
import type { IslandDescriptor, PluralRules, ScreenRef, Strings } from "@client-compose/protocol";
import { createElement, type ReactElement, type ReactNode } from "react";

import { ComposedScreen } from "./client.ts";
import type { ClientComposeConfig } from "./config.ts";
import { IslandStrings } from "./islandStrings.ts";

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
    client: {
      platform: "web",
      appVersion: "test",
      locale: "en",
    },
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
  return {
    config,
    gateway,
    navigations,
    invalidations,
  };
}

/** A page of a paged island: its props, and the cursor for the page after it (none at the end). */
export interface IslandPage<P> {
  props: P;
  next?: string;
}

export interface PagedIslandOptions<P> {
  island: IslandDescriptor<P>;
  /** The page the screen comes with. */
  first: IslandPage<P>;
  /** The pages after it, by the cursor that asks for each. Any other cursor is `invalid_cursor`. */
  pages: Record<string, IslandPage<P>>;
  /** The screen it's on, and its key there. Default: "paged" and "island". */
  screen?: string;
  key?: string;
}

export interface PagedIsland {
  /** The screen, to render inside your provider: the island fetches its pages from it. */
  element: ReactElement;
  /** How the fake composer answers: the screen, and the island's pages. Add your own to them. */
  handlers: FakeGatewayHandlers;
}

/**
 * A paged island on a screen of its own, for testing it: `usePages` fetches the next pages of the
 * island it's in from the screen it's on, so the island is rendered from a screen, not alone.
 *
 *     const paged = pagedIsland({
 *       island: ResultListV1,
 *       first: { props: { items: ["a", "b"] }, next: "c2" },
 *       pages: { c2: { props: { items: ["c"] } } },
 *     });
 *     const { config, gateway } = createTestConfig({ registry, handlers: paged.handlers });
 *     render(<ClientComposeProvider config={config}>{paged.element}</ClientComposeProvider>);
 *     // ...scroll to the end, then:
 *     expect(gateway.islandRequests().map((r) => r.cursor)).toEqual(["c2"]);
 *
 * The registry renders the island: register its component as the app does.
 */
export function pagedIsland<P>(options: PagedIslandOptions<P>): PagedIsland {
  const { island: descriptor, first, pages, screen: id = "paged", key = "island" } = options;
  const entry = (page: IslandPage<P>) => island(key, descriptor, page.props, page.next);
  return {
    element: createElement(ComposedScreen, { screen: id }),
    handlers: {
      screens: { [id]: () => screen(id, [entry(first)]) },
      islands: {
        [`${id}/${key}`]: (request) => {
          const page = request.cursor === undefined ? undefined : pages[request.cursor];
          return page ? islandResponse(id, entry(page)) : screenError(400, "invalid_cursor");
        },
      },
    },
  };
}

/** An island's strings and its screen's plural rules, as the composer sends them. */
export interface InIslandOptions {
  strings?: Strings;
  plurals?: PluralRules;
}

/**
 * A node inside an island, as the registry renders it: for a test that renders an island's component
 * itself, when a component inside it reads the island's strings with `useIslandStrings`.
 *
 *     render(inIsland(ProfileHeaderV1, <ProfileHeader t={english.t(ProfileHeaderV1)} {...props} />, {
 *       strings: english.strings(ProfileHeaderV1),
 *       plurals: english.plurals,
 *     }));
 */
export function inIsland<P, S>(
  descriptor: IslandDescriptor<P, S>,
  node: ReactNode,
  options: InIslandOptions = {},
): ReactElement {
  return createElement(
    IslandStrings,
    {
      type: descriptor.type,
      version: descriptor.version,
      ...options,
    },
    node,
  );
}
