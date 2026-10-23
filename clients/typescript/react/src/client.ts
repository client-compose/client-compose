"use client";

// Everything that needs React state, effects or context. Marked "use client" so that, in React
// Server Components, importing the package from a Server Component treats these as Client
// Components instead of running them on the server.

import {
  buildActionRequest,
  buildIslandRequest,
  checkActionResponse,
  fetchAction,
  fetchIsland,
  newIdempotencyKey,
  plan,
  type PlannedIsland,
} from "@client-compose/client";
import {
  type ActionDescriptor,
  type ActionEffects,
  type ActionResponse,
  type DeclaredError,
  type IslandError,
  type ScreenRef,
  screenRefMatches,
  type ScreenResponse,
} from "@client-compose/protocol";
import {
  Component,
  createContext,
  createElement,
  Fragment,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ClientComposeConfig } from "./config.ts";
import { loadScreen } from "./load.ts";

interface CacheEntry {
  screen: string;
  params: Record<string, string>;
  response: ScreenResponse;
  expiresAt: number;
}

/** A screen currently shown with useScreen, so that actions can reload it. */
interface MountedScreen {
  screen: string;
  params: Record<string, string>;
  reload: () => void;
}

/**
 * The provider's screens: cached responses, and the screens on show, which actions that change them
 * reload (spec §5.3).
 */
class ScreenStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly mounted = new Set<MountedScreen>();

  /** The cached response for a key, while it's fresh. */
  cached(key: string): ScreenResponse | undefined {
    const entry = this.cache.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.response : undefined;
  }

  /** Keep a response for its `cache.maxAge`. */
  remember(key: string, screen: string, params: Record<string, string>, response: ScreenResponse) {
    if (!response.cache || response.cache.maxAge <= 0) return;
    const expiresAt = Date.now() + response.cache.maxAge * 1000;
    this.cache.set(key, { screen, params, response, expiresAt });
  }

  /** A screen on show. Returns the function that takes it off. */
  mount(screen: MountedScreen): () => void {
    this.mounted.add(screen);
    return () => void this.mounted.delete(screen);
  }

  /** Drop cached responses the refs match, and reload the screens on show that they match. */
  invalidate(refs: ScreenRef[]) {
    const matches = (screen: string, params: Record<string, string>) =>
      refs.some((ref) => screenRefMatches(ref, screen, params));
    for (const [key, entry] of this.cache) {
      if (matches(entry.screen, entry.params)) this.cache.delete(key);
    }
    for (const m of this.mounted) {
      if (matches(m.screen, m.params)) m.reload();
    }
  }
}

interface ContextValue {
  config: ClientComposeConfig;
  screens: ScreenStore;
  applyEffects: (effects: ActionEffects) => void;
}

const ClientComposeContext = createContext<ContextValue | null>(null);

export function ClientComposeProvider(props: {
  config: ClientComposeConfig;
  children?: ReactNode;
}): ReactNode {
  const [screens] = useState(() => new ScreenStore());
  const value = useMemo((): ContextValue => {
    const config = props.config;
    const applyEffects = (effects: ActionEffects) => {
      const refs = effects.invalidate ?? [];
      if (refs.length) {
        screens.invalidate(refs);
        config.onInvalidate?.(refs);
      }
      if (effects.navigate) config.onNavigate?.(effects.navigate);
    };
    return { config, screens, applyEffects };
  }, [props.config, screens]);
  return createElement(ClientComposeContext.Provider, { value }, props.children);
}

function useClientCompose(): ContextValue {
  const ctx = useContext(ClientComposeContext);
  if (!ctx)
    throw new Error(
      "Client Compose hooks and components must be used inside <ClientComposeProvider>",
    );
  return ctx;
}

export interface ScreenState {
  /** `loading` until the first response; `error` only if there's nothing to show. */
  status: "loading" | "ready" | "error";
  islands: PlannedIsland<ReactNode>[];
  response?: ScreenResponse;
  /** The last request's error. With `status: "ready"`, a refresh failed and older islands are shown. */
  error?: unknown;
  /** A request is in flight (initial load or reload). */
  refreshing: boolean;
  /** Fetch again, bypassing the cache. Keeps showing current islands until the new ones arrive. */
  reload: () => void;
}

export interface UseScreenOptions {
  /**
   * A response already fetched on the server (see `loadScreen`) for the current screen and params.
   * It's rendered without a request, so server-rendered HTML matches and hydration doesn't fetch
   * again. Passing a new one later (e.g. after a framework navigation or refresh re-runs your
   * server code) is adopted the same way.
   */
  initialResponse?: ScreenResponse;
}

interface FetchState {
  key: string;
  response?: ScreenResponse;
  error?: unknown;
  refreshing: boolean;
}

/** Fetch and plan a screen. Use this directly for custom layouts (e.g. a React Native FlatList). */
export function useScreen(
  screen: string,
  params: Record<string, string> = {},
  options: UseScreenOptions = {},
): ScreenState {
  const { config, screens } = useClientCompose();
  const key = `${screen}?${stableKey(params)}`;
  const latestParams = useRef(params);
  latestParams.current = params;
  const force = useRef(false);
  const [reloads, setReloads] = useState(0);
  const store = (response: ScreenResponse) =>
    screens.remember(key, screen, latestParams.current, response);

  // The latest server-provided response, and the screen key it was provided for.
  const [seed, setSeed] = useState(() => ({
    response: options.initialResponse,
    key: options.initialResponse ? key : null,
  }));
  if (options.initialResponse && options.initialResponse !== seed.response) {
    // A new response from the server (navigation or refresh): adopt it for the current key.
    setSeed({ response: options.initialResponse, key });
  }

  const cached = () => (config.cache === false ? undefined : screens.cached(key));
  const [state, setState] = useState<FetchState>(() => ({
    key,
    response: options.initialResponse ?? cached(),
    refreshing: false,
  }));

  useEffect(() => {
    const forced = force.current;
    force.current = false;
    if (!forced && seed.key === key && seed.response) {
      // Use the server's response without a request (StrictMode remounts land here too).
      const response = seed.response;
      if (config.cache !== false) store(response);
      setState((prev) =>
        prev.key === key && prev.response === response
          ? prev
          : { key, response, refreshing: false },
      );
      return;
    }

    const fresh = forced ? undefined : cached();
    if (fresh) {
      setState({ key, response: fresh, refreshing: false });
      return;
    }

    const controller = new AbortController();
    setState((prev) =>
      prev.key === key ? { ...prev, refreshing: true } : { key, refreshing: true },
    );
    (async () => {
      try {
        const response = await loadScreen(config, screen, latestParams.current, {
          signal: controller.signal,
        });
        store(response);
        if (!controller.signal.aborted) setState({ key, response, refreshing: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          key,
          response: prev.key === key ? prev.response : undefined,
          error,
          refreshing: false,
        }));
      }
    })();
    return () => controller.abort();
    // `key` covers screen and params; a new server response or config (e.g. a new registry) re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloads, config, seed]);

  // Until the effect for a new key runs, show the server's response for it if there is one, and
  // never the previous key's islands.
  const seeded = seed.key === key ? seed.response : undefined;
  const current: FetchState =
    state.key === key
      ? state
      : { key, response: seeded ?? cached(), refreshing: seeded === undefined };
  const { response } = current;

  const islands = useMemo(
    () =>
      response
        ? scoped(
            plan(config.registry, response, {
              onError: config.renderIslandError,
              onSkipped: config.onSkipped,
            }),
            response,
            latestParams.current,
          )
        : [],
    [response, config],
  );

  const reload = useCallback(() => {
    force.current = true;
    setReloads((n) => n + 1);
  }, []);

  // Let actions that change this screen reload it (spec §5.3).
  useEffect(() => {
    return screens.mount({ screen, params: latestParams.current, reload });
    // `key` covers screen and params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, screens, reload]);

  return {
    status: response ? "ready" : current.error !== undefined ? "error" : "loading",
    islands,
    response,
    error: current.error,
    refreshing: current.refreshing,
    reload,
  };
}

// ---- Island requests (spec §4.5) ----

/** Where an island is: its screen and the screen's params, its key and version, and its `next`. */
export interface IslandScopeValue {
  screen: string;
  params: Record<string, string>;
  key: string;
  version: number;
  next?: string;
}

const IslandScopeContext = createContext<IslandScopeValue | null>(null);

/**
 * Tells the island inside it where it is, so it can fetch its next page (usePages). useScreen and
 * <ComposedScreen> put one around every island; so does the Server Component entry.
 */
export function IslandScope(props: { value: IslandScopeValue; children?: ReactNode }): ReactNode {
  return createElement(IslandScopeContext.Provider, { value: props.value }, props.children);
}

/** Planned islands, each inside its IslandScope. */
function scoped(
  islands: PlannedIsland<ReactNode>[],
  response: ScreenResponse,
  params: Record<string, string>,
): PlannedIsland<ReactNode>[] {
  return islands.map((island) => {
    const entry = response.islands.find((e) => e.key === island.key);
    if (entry?.status !== "ok") return island;
    const value: IslandScopeValue = {
      screen: response.screen,
      params,
      key: entry.key,
      version: entry.version,
      ...(entry.next !== undefined && { next: entry.next }),
    };
    return {
      key: island.key,
      render: () => createElement(IslandScope, { value }, island.render()),
    };
  });
}

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
   * `{ code: "timeout", retryable: true }`), or the request's (e.g. a `ScreenFetchError`).
   */
  error?: IslandError | unknown;
  /** Fetch the next page, unless one is loading or there are no more. */
  loadMore: () => void;
}

interface Pages<P> {
  /** The props the pages start from: new props (another search, a reload) start again. */
  first: P;
  more: P[];
  next: string | undefined;
  loading: boolean;
  error?: unknown;
}

/**
 * The pages of a paged island (spec §4.5), from the props it was rendered with. Call it in the
 * island's component, with its props, and lay out every page, usually by flattening their items:
 *
 *     function Results(props: ResultListV1) {
 *       const { pages, status, loadMore } = usePages(props);
 *       const items = pages.flatMap((page) => page.items);
 *       return <FlatList data={items} onEndReached={loadMore} … />;
 *     }
 *
 * When the island is rendered with new props (the screen reloaded, or opened with other params),
 * it starts again from them. A page that arrives after that is dropped.
 */
export function usePages<P>(props: P): PagesState<P> {
  const { config } = useClientCompose();
  const scope = useContext(IslandScopeContext);
  const [pages, setPages] = useState<Pages<P>>(() => ({
    first: props,
    more: [],
    next: scope?.next,
    loading: false,
  }));
  const current: Pages<P> =
    pages.first === props ? pages : { first: props, more: [], next: scope?.next, loading: false };
  if (current !== pages) setPages(current); // new props: start again from them

  const loadMore = () => {
    if (!scope || current.loading || current.next === undefined) return;
    const first = current.first;
    const cursor = current.next;
    // Only for the pages it was asked for: newer props start again.
    const update = (change: (p: Pages<P>) => Pages<P>) =>
      setPages((p) => (p.first === first ? change(p) : p));
    update((p) => ({ ...p, loading: true, error: undefined }));
    void (async () => {
      try {
        const request = buildIslandRequest(
          scope.screen,
          scope.params,
          scope,
          config.client,
          cursor,
        );
        const entry = await fetchIsland(
          config.baseUrl,
          request,
          { ...config.requestInit, headers: await config.headers?.() },
          config.fetch,
        );
        if (entry.status === "ok") {
          update((p) => ({
            ...p,
            more: [...p.more, entry.props as P],
            next: entry.next,
            loading: false,
          }));
        } else {
          update((p) => ({ ...p, loading: false, error: entry.error }));
        }
      } catch (error) {
        update((p) => ({ ...p, loading: false, error }));
      }
    })();
  };

  return {
    pages: [current.first, ...current.more],
    status: pagesStatus(current),
    ...(current.error !== undefined && { error: current.error }),
    loadMore,
  };
}

function pagesStatus<P>(pages: Pages<P>): PagesStatus {
  if (pages.loading) return "loading";
  if (pages.error !== undefined) return "failed";
  return pages.next === undefined ? "end" : "more";
}

interface BoundaryProps {
  islandKey: string;
  children?: ReactNode;
}

/**
 * Hides one island if it throws while rendering, so the rest of the screen stays. Reports through
 * the nearest `ClientComposeProvider`'s `onRenderError`, if there is one. Also used around islands
 * rendered by Server Components, where an error thrown on the server is re-thrown here.
 */
export class IslandBoundary extends Component<BoundaryProps, { failed: boolean }> {
  static contextType = ClientComposeContext;
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    (this.context as ContextValue | null)?.config.onRenderError?.(this.props.islandKey, error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function IslandContent(props: { island: PlannedIsland<ReactNode> }): ReactNode {
  // Rendering inside the boundary means a throwing renderer is caught too.
  return props.island.render();
}

/**
 * Isolates one island. During server rendering React ignores error boundaries and sends errors to
 * the nearest <Suspense>, so each island gets its own: a crashing island renders as nothing on the
 * server, then IslandBoundary catches the error when the browser renders it. (server.ts builds the
 * same structure; it can't call this function, because it's in a "use client" module.)
 */
function isolateIsland(key: string, node: ReactNode): ReactNode {
  return createElement(
    Suspense,
    { key, fallback: null },
    createElement(IslandBoundary, { islandKey: key }, node),
  );
}

/** Render one planned island, isolated so that it can't break the rest of the screen. */
export function Island(props: { island: PlannedIsland<ReactNode> }): ReactNode {
  return isolateIsland(props.island.key, createElement(IslandContent, { island: props.island }));
}

export interface ComposedScreenProps {
  screen: string;
  params?: Record<string, string>;
  /** A response fetched on the server with `loadScreen`, for server rendering and hydration. */
  initialResponse?: ScreenResponse;
  /** Shown until the first response. */
  loading?: ReactNode;
  /** Shown if the first request fails. */
  renderError?: (error: unknown, reload: () => void) => ReactNode;
  /**
   * Lay out the rendered islands yourself, e.g. inside a ScrollView. Each node is already keyed
   * and wrapped in an error boundary. Default: render them in order with no wrapper.
   */
  children?: (islands: ReactNode[], screen: ScreenState) => ReactNode;
}

/** Fetch a screen and render its islands in order. */
export function ComposedScreen(props: ComposedScreenProps): ReactNode {
  const screen = useScreen(props.screen, props.params, { initialResponse: props.initialResponse });
  if (screen.status === "loading") return props.loading ?? null;
  if (screen.status === "error") return props.renderError?.(screen.error, screen.reload) ?? null;
  const nodes = screen.islands.map((island) => createElement(Island, { key: island.key, island }));
  return props.children ? props.children(nodes, screen) : createElement(Fragment, null, ...nodes);
}

function stableKey(params: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]]),
  );
}

/** How an action call ended: its result, one of its declared errors, or a failed call. */
export type ActionResult<R, E extends DeclaredError> =
  | ActionResponse<R, E>
  | {
      status: "failed";
      /** e.g. an `ActionFetchError` (`invalid_input`, `unauthenticated`, `action_failed`...) or a network error. */
      error: unknown;
    };

export interface ActionState<I, R, E extends DeclaredError> {
  /**
   * Perform the action. Never rejects: resolves with the result, a declared error, or
   * `{ status: "failed" }`. On success the action's effects are applied first: matching screens
   * reload, and `onInvalidate` / `onNavigate` are called.
   *
   * Each call uses a new idempotency key unless you pass one (do, when retrying the same intent).
   */
  run: (input: I, options?: { idempotencyKey?: string }) => Promise<ActionResult<R, E>>;
  /** A call is in flight. */
  pending: boolean;
  /** How the last call ended. */
  last?: ActionResult<R, E>;
  /** Forget `last`, e.g. when the user edits a form after an error. */
  reset: () => void;
}

/**
 * Perform an action from a component, with its generated descriptor:
 *
 *     const follow = useAction(FollowUserV1);
 *     const res = await follow.run({ userId });
 *     if (res.status === "error" && res.error.code === "blocked") ...
 */
export function useAction<I, R, E extends DeclaredError>(
  action: ActionDescriptor<I, R, E>,
): ActionState<I, R, E> {
  const { config, applyEffects } = useClientCompose();
  const [inFlight, setInFlight] = useState(0);
  const [last, setLast] = useState<ActionResult<R, E> | undefined>(undefined);

  const run = useCallback(
    async (input: I, options: { idempotencyKey?: string } = {}): Promise<ActionResult<R, E>> => {
      setInFlight((n) => n + 1);
      let outcome: ActionResult<R, E>;
      try {
        const request = buildActionRequest(
          action,
          input,
          config.client,
          options.idempotencyKey ?? newIdempotencyKey(),
        );
        const response = config.performAction
          ? await config.performAction(request)
          : await fetchAction(
              config.baseUrl,
              request,
              { headers: await config.headers?.() },
              config.fetch,
            );
        outcome = checkActionResponse(action, response);
        if (outcome.status === "ok" && outcome.effects) applyEffects(outcome.effects);
      } catch (error) {
        outcome = { status: "failed", error };
      } finally {
        setInFlight((n) => n - 1);
      }
      setLast(outcome);
      return outcome;
    },
    [action, config, applyEffects],
  );

  const reset = useCallback(() => setLast(undefined), []);
  return { run, pending: inFlight > 0, last, reset };
}
