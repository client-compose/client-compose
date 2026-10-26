// @client-compose/react/server: render a composed screen in a React Server Component.
//
// The screen is fetched and its islands rendered on the server, so the HTML arrives complete and no
// client JavaScript is needed for islands that are Server Components. Islands can also be Client
// Components (files marked "use client"); they hydrate as usual.

import { plan } from "@client-compose/client";
import type { ScreenResponse } from "@client-compose/protocol";
import { createElement, Fragment, type ReactNode, Suspense } from "react";

// Only components may be imported from the "use client" module here: from a Server Component,
// they're client references that can be rendered, never called.
import { IslandBoundary } from "./client.ts";
import type { ScreenConfig } from "./config.ts";
import { loadScreen } from "./load.ts";

export type { ErrorEntry, ScreenConfig } from "./config.ts";
export { loadScreen } from "./load.ts";
export { ReactIslandRegistry } from "./registry.ts";
// Re-exported so React apps (including codegen output) only need this one package.
export type { IslandDescriptor, ScreenMeta, ScreenResponse } from "@client-compose/protocol";

export interface ServerComposedScreenProps {
  config: ScreenConfig;
  screen: string;
  params?: Record<string, string>;
  /**
   * A response (or its promise) you've already loaded with `loadScreen`, e.g. because
   * `generateMetadata` needs its `meta` too. Given this, the component doesn't fetch. Wrap your
   * loader in React's `cache()` so both share one request.
   */
  response?: ScreenResponse | Promise<ScreenResponse>;
  /**
   * Streamed while the screen loads. Omit it to suspend to the nearest `<Suspense>` boundary (or
   * your framework's loading UI) instead.
   */
  fallback?: ReactNode;
  /**
   * Rendered if the screen request fails. Omit it to throw to the nearest error boundary (e.g. a
   * Next.js `error.tsx`).
   */
  renderError?: (error: unknown) => ReactNode;
  /**
   * Lay out the rendered islands yourself. Each node is already keyed and wrapped in an error
   * boundary. Default: render them in order with no wrapper.
   */
  children?: (islands: ReactNode[], response: ScreenResponse) => ReactNode;
}

/** Fetch a screen on the server and render its islands. A React Server Component. */
export function ComposedScreen(props: ServerComposedScreenProps): ReactNode {
  const content = createElement(ScreenIslands, props);
  return props.fallback === undefined
    ? content
    : createElement(Suspense, { fallback: props.fallback }, content);
}

async function ScreenIslands(props: ServerComposedScreenProps): Promise<ReactNode> {
  const { config } = props;
  let response: ScreenResponse;
  try {
    response = await (props.response ?? loadScreen(config, props.screen, props.params));
  } catch (error) {
    if (props.renderError) {
      return props.renderError(error);
    }
    throw error;
  }

  const nodes: ReactNode[] = [];
  for (const island of plan(config.registry, response, {
    onError: config.renderIslandError,
    onSkipped: config.onSkipped,
  })) {
    let node: ReactNode;
    try {
      // Creates the island's element. Errors thrown while the component itself renders are
      // caught by IslandBoundary on the client instead.
      node = island.render();
    } catch (error) {
      config.onRenderError?.(island.key, error);
      continue;
    }
    // As on the client: its own <Suspense> so a server render error stays inside this island, and
    // IslandBoundary to hide it once the browser re-renders it.
    nodes.push(
      createElement(
        Suspense,
        { key: island.key, fallback: null },
        createElement(IslandBoundary, { islandKey: island.key }, node),
      ),
    );
  }
  return props.children ? props.children(nodes, response) : createElement(Fragment, null, ...nodes);
}
