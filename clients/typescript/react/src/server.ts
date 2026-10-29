// @client-compose/react/server: render a composed screen in a React Server Component.
//
// The screen is fetched and its islands rendered on the server, so no client JavaScript is needed
// for islands that are Server Components. Islands can also be Client Components (files marked
// "use client"); they hydrate as usual. The screen streams (spec §4.6): islands still pending in its
// head render as their placeholders, each in its own <Suspense>, and stream in as they arrive.

import { collectScreen, heldEntities, plan, type ScreenStream } from "@client-compose/client";
import type { IslandEntry, ScreenHead, ScreenResponse } from "@client-compose/protocol";
import { createElement, Fragment, isValidElement, type ReactNode, Suspense } from "react";

// Only components may be imported from the "use client" module here: from a Server Component,
// they're client references that can be rendered, never called.
import { IslandBoundary } from "./client.ts";
import type { ScreenConfig } from "./config.ts";
import { streamScreen } from "./load.ts";
import { IslandScope } from "./pages.ts";
import { ClientIsland, ServerIsland } from "./rendered.ts";
import { scopeOf } from "./scope.ts";

export { type ServerComposer, serverComposer, type ServerComposerOptions } from "./composer.ts";
export type { ErrorEntry, ScreenConfig } from "./config.ts";
export { loadScreen, streamScreen } from "./load.ts";
export { ReactIslandRegistry } from "./registry.ts";
export { richText } from "./rich.ts";
// Re-exported so React apps (including codegen output) only need this one package.
export {
  appStrings,
  fetchStrings,
  type IslandProps,
  preferredLocale,
  type ScreenStream,
} from "@client-compose/client";
export type {
  AppStringsDescriptor,
  EntityDescriptor,
  EntityPath,
  IslandDescriptor,
  ScreenHead,
  ScreenMeta,
  ScreenResponse,
} from "@client-compose/protocol";

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
   * The screen's stream (or its promise) you've already opened with `streamScreen`, e.g. because
   * `generateMetadata` reads its head's `meta`. Given this, the component doesn't fetch, and the
   * screen still streams. Wrap your opener in React's `cache()` so both share one request.
   */
  stream?: ScreenStream | Promise<ScreenStream>;
  /**
   * Streamed until the screen's head arrives. Omit it to suspend to the nearest `<Suspense>`
   * boundary (or your framework's loading UI) instead.
   */
  fallback?: ReactNode;
  /**
   * Stream islands in as they arrive, each pending one showing its placeholder until then (the
   * default, unless the config's `progressive` is false), or wait for the whole screen.
   */
  progressive?: boolean;
  /**
   * Rendered if the screen request fails. Omit it to throw to the nearest error boundary (e.g. a
   * Next.js `error.tsx`).
   */
  renderError?: (error: unknown) => ReactNode;
  /**
   * Lay out the rendered islands yourself. Each node is already keyed and wrapped in an error
   * boundary. Default: render them in order with no wrapper.
   */
  children?: (islands: ReactNode[], response: ScreenHead) => ReactNode;
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
  let screen: ScreenStream;
  try {
    screen = await screenFor(props);
  } catch (error) {
    if (props.renderError) {
      return props.renderError(error);
    }
    throw error;
  }
  const { head } = screen;
  const arriving = arrivals(head, screen.islands);
  const params = props.params ?? {};

  const nodes: ReactNode[] = [];
  for (const entry of head.islands) {
    const coming = arriving.get(entry.key);
    if (entry.status === "pending" && coming) {
      if (!config.registry.get(entry.type, entry.version)) {
        continue;
      }
      // Its placeholder (or nothing) until it arrives, then the island, streamed in.
      const placeholder = config.registry.placeholder(entry.type, entry.version);
      const island = createElement(Arriving, {
        config,
        head,
        params,
        entry: coming,
      });
      nodes.push(isolated(entry.key, island, placeholder?.() ?? null));
      continue;
    }
    const node = entryNode(config, { ...head, islands: [entry] }, params);
    if (node !== undefined) {
      nodes.push(isolated(entry.key, node, null));
    }
  }
  return props.children ? props.children(nodes, head) : createElement(Fragment, null, ...nodes);
}

/** The screen: the response given, as a stream that's complete, or its stream from the composer. */
async function screenFor(props: ServerComposedScreenProps): Promise<ScreenStream> {
  if (props.response) {
    return complete(await props.response);
  }
  const stream = await (props.stream ?? streamScreen(props.config, props.screen, props.params));
  const progressive = props.progressive ?? props.config.progressive ?? true;
  return progressive ? stream : complete(await collectScreen(stream));
}

/** A screen that's all there: a head with nothing pending, and no islands to follow. */
function complete(response: ScreenResponse): ScreenStream {
  return { head: response, islands: noIslands() };
}

async function* noIslands(): AsyncIterable<IslandEntry> {}

/** Each pending island's entry, by key, as it arrives. */
function arrivals(
  head: ScreenHead,
  islands: AsyncIterable<IslandEntry>,
): Map<string, Promise<IslandEntry>> {
  const waiting = new Map<string, (entry: IslandEntry) => void>();
  const out = new Map<string, Promise<IslandEntry>>();
  for (const e of head.islands) {
    if (e.status === "pending") {
      out.set(e.key, new Promise((resolve) => waiting.set(e.key, resolve)));
    }
  }
  if (waiting.size > 0) {
    void deliver(head, islands, waiting).catch(() => undefined);
  }
  return out;
}

/**
 * Hands each island the stream brings to whoever's waiting for it, as it comes. If the stream breaks
 * off, the islands that never came are errors: `incomplete`, retryable (spec §4.6).
 */
async function deliver(
  head: ScreenHead,
  islands: AsyncIterable<IslandEntry>,
  waiting: Map<string, (entry: IslandEntry) => void>,
): Promise<void> {
  try {
    for await (const entry of islands) {
      waiting.get(entry.key)?.(entry);
      waiting.delete(entry.key);
    }
  } finally {
    for (const [key, resolve] of waiting) {
      const pending = head.islands.find((e) => e.key === key);
      resolve({
        key,
        type: pending?.type ?? "",
        version: pending?.version ?? 0,
        status: "error",
        error: { code: "incomplete", retryable: true },
      });
    }
  }
}

interface ArrivingProps {
  config: ScreenConfig;
  head: ScreenHead;
  params: Record<string, string>;
  entry: Promise<IslandEntry>;
}

/** A pending island, once it's arrived: suspends until then. */
async function Arriving(props: ArrivingProps): Promise<ReactNode> {
  const entry = await props.entry;
  return entryNode(props.config, { ...props.head, islands: [entry] }, props.params) ?? null;
}

/**
 * The element of the one island in `head` (as planned: an error's fallback, or nothing), knowing
 * where it is (for usePages). Undefined if there's nothing to show, or it threw.
 */
function entryNode(
  config: ScreenConfig,
  head: ScreenHead,
  params: Record<string, string>,
): ReactNode | undefined {
  const [island] = plan(config.registry, head, {
    onError: config.renderIslandError,
    onSkipped: config.onSkipped,
  });
  if (!island) {
    return undefined;
  }
  let node: ReactNode;
  try {
    // Creates the island's element. Errors thrown while the component itself renders are caught
    // by IslandBoundary on the client instead.
    node = island.render();
  } catch (error) {
    config.onRenderError?.(island.key, error);
    return undefined;
  }
  const scope = scopeOf(head, params, island.key);
  if (!scope) {
    return node;
  }

  return createElement(IslandScope, { value: scope }, changeable(config, head, node));
}

/**
 * An island as actions' changes and updates reach it in the browser (spec §5.3): a Client Component
 * island applies them itself; any other says when they touch what it holds, for the server to
 * render it again.
 */
function changeable(config: ScreenConfig, head: ScreenHead, node: ReactNode): ReactNode {
  const [entry] = head.islands;
  if ((isValidElement(node) && node.type === ClientIsland) || entry?.status !== "ok") {
    return node;
  }

  const holds = heldEntities(entry.props, config.registry.entities(entry.type, entry.version));

  return createElement(ServerIsland, { holds }, node);
}

/**
 * As on the client: its own <Suspense> so a server render error stays inside this island, and
 * IslandBoundary to hide it once the browser re-renders it. A pending island's fallback is its
 * placeholder.
 */
function isolated(key: string, node: ReactNode, fallback: ReactNode): ReactNode {
  return createElement(
    Suspense,
    { key, fallback },
    createElement(IslandBoundary, { islandKey: key }, node),
  );
}
