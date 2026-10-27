"use client";

// Islands with pages (spec §4.5): each island knows where it is (its scope), and usePages fetches
// its next pages from there.

import { buildIslandRequest, fetchIsland, type PlannedIsland } from "@client-compose/client";
import type { IslandEntry, IslandError, IslandRequest, ScreenHead } from "@client-compose/protocol";
import { createContext, createElement, type ReactNode, useContext, useState } from "react";

import type { ClientComposeConfig } from "./config.ts";
import { useClientCompose } from "./provider.ts";
import { type IslandScopeValue, scopeOf } from "./scope.ts";

// ---- Where an island is ----

const IslandScopeContext = createContext<IslandScopeValue | null>(null);

export interface IslandScopeProps {
  value: IslandScopeValue;
  children?: ReactNode;
}

/**
 * Tells the island inside it where it is, so it can fetch its next page (usePages). useScreen and
 * <ComposedScreen> put one around every island; so does the Server Component entry.
 */
export function IslandScope(props: IslandScopeProps): ReactNode {
  return createElement(IslandScopeContext.Provider, { value: props.value }, props.children);
}

/** A screen's planned islands, each inside its IslandScope. */
export function scopeIslands(
  islands: PlannedIsland<ReactNode>[],
  response: ScreenHead,
  params: Record<string, string>,
): PlannedIsland<ReactNode>[] {
  return islands.map((island) => {
    const value = scopeOf(response, params, island.key);
    if (!value) {
      return island;
    }
    return {
      key: island.key,
      render: () => createElement(IslandScope, { value }, island.render()),
    };
  });
}

// ---- Its pages ----

/**
 * "more" while there's a next page, "loading" while it loads, "end" when there are no more (or the
 * island has no pages), "failed" when the last page couldn't load: `loadMore` tries it again.
 */
export type PagesStatus = "more" | "loading" | "end" | "failed";

export interface PagesState<P> {
  /** The island's pages so far: the props it was rendered with, then each page loaded since. */
  pages: P[];
  status: PagesStatus;
  /**
   * Why the last page failed: the island's error from the composer (an `IslandError`, e.g.
   * `{ code: "timeout", retryable: true }`), or the request's (e.g. an `IslandFetchError`).
   */
  error?: IslandError | unknown;
  /** Fetch the next page, unless one is loading or there are no more. */
  loadMore: () => void;
}

/** The pages loaded after the first: what usePages keeps, for the props it started from. */
interface Pages<P> {
  /** The props the pages follow. Rendered with others (another search, a reload), it starts again. */
  first: P;
  more: P[];
  next: string | undefined;
  loading: boolean;
  error?: unknown;
}

function startingFrom<P>(first: P, next: string | undefined): Pages<P> {
  return {
    first,
    more: [],
    next,
    loading: false,
  };
}

function loadingNext<P>(pages: Pages<P>): Pages<P> {
  return {
    ...pages,
    loading: true,
    error: undefined,
  };
}

/** The pages with the one that came back added, or with why it failed. */
function afterPage<P>(pages: Pages<P>, entry: IslandEntry): Pages<P> {
  if (entry.status !== "ok") {
    return {
      ...pages,
      loading: false,
      error: entry.error,
    };
  }
  // The page is the island's own props, at the version it's shown at (fetchIsland checks).
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const page = entry.props as P;
  return {
    ...pages,
    more: [...pages.more, page],
    next: entry.next,
    loading: false,
  };
}

function failed<P>(pages: Pages<P>, error: unknown): Pages<P> {
  return {
    ...pages,
    loading: false,
    error,
  };
}

function statusOf<P>(pages: Pages<P>): PagesStatus {
  if (pages.loading) {
    return "loading";
  }
  if (pages.error !== undefined) {
    return "failed";
  }
  return pages.next === undefined ? "end" : "more";
}

/** Fetch an island's page: through the config's `loadIsland` if it has one, else from the composer. */
async function fetchPage(
  config: ClientComposeConfig,
  request: IslandRequest,
): Promise<IslandEntry> {
  if (config.loadIsland) {
    return config.loadIsland(request);
  }
  const headers = await config.headers?.();
  return fetchIsland(config.baseUrl, request, { ...config.requestInit, headers }, config.fetch);
}

/**
 * The pages of a paged island (spec §4.5), from the props it was rendered with. Call it in the
 * island's component, with its props, and lay out every page, usually by flattening their items:
 *
 *     function Results(props: ResultListV1) {
 *       const { pages, status, loadMore } = usePages(props);
 *       const items = pages.flatMap((page) => page.items);
 *       …
 *     }
 *
 * Rendered with new props (the screen reloaded, or opened with other params), it starts again from
 * them, and a page still on its way for the old ones is dropped.
 */
export function usePages<P>(props: P): PagesState<Omit<P, "t">> {
  const { config } = useClientCompose();
  const scope = useContext(IslandScopeContext);
  const [kept, setKept] = useState(() => startingFrom(props, scope?.next));
  // What's kept, if it follows these props; otherwise they start again.
  const pages = kept.first === props ? kept : startingFrom(props, scope?.next);

  /** Changes the pages that follow `first`, unless the island has moved on to other props. */
  const update = (first: P, change: (p: Pages<P>) => Pages<P>) =>
    setKept((p) => (p.first === first ? change(p) : p));

  async function loadNextPage(current: Pages<P>, cursor: string, from: IslandScopeValue) {
    const first = current.first;
    setKept(loadingNext(current));
    try {
      const request = buildIslandRequest(from.screen, from.params, from, config.client, cursor);
      const entry = await fetchPage(config, request);
      update(first, (p) => afterPage(p, entry));
    } catch (error) {
      update(first, (p) => failed(p, error));
    }
  }

  const loadMore = () => {
    if (scope && !pages.loading && pages.next !== undefined) {
      void loadNextPage(pages, pages.next, scope);
    }
  };

  return {
    pages: [pages.first, ...pages.more],
    status: statusOf(pages),
    ...(pages.error !== undefined && { error: pages.error }),
    loadMore,
  };
}
