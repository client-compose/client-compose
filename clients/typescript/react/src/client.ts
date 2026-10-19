"use client";

// Everything that needs React state, effects or context. Marked "use client" so that, in React
// Server Components, importing the package from a Server Component treats these as Client
// Components instead of running them on the server.

import {
  Component,
  createContext,
  createElement,
  Fragment,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { plan, type PlannedIsland } from "@client-compose/client";
import type { ScreenResponse } from "@client-compose/protocol";
import type { ClientComposeConfig } from "./config.ts";
import { loadScreen } from "./load.ts";

interface CacheEntry {
  response: ScreenResponse;
  expiresAt: number;
}

interface ContextValue {
  config: ClientComposeConfig;
  cache: Map<string, CacheEntry>;
}

const ClientComposeContext = createContext<ContextValue | null>(null);

export function ClientComposeProvider(props: { config: ClientComposeConfig; children?: ReactNode }): ReactNode {
  const cache = useMemo(() => new Map<string, CacheEntry>(), []);
  const value = useMemo(() => ({ config: props.config, cache }), [props.config, cache]);
  return createElement(ClientComposeContext.Provider, { value }, props.children);
}

function useClientCompose(): ContextValue {
  const ctx = useContext(ClientComposeContext);
  if (!ctx) throw new Error("Client Compose hooks and components must be used inside <ClientComposeProvider>");
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
  const { config, cache } = useClientCompose();
  const key = `${screen}?${stableKey(params)}`;
  const latestParams = useRef(params);
  latestParams.current = params;
  const force = useRef(false);
  const [reloads, setReloads] = useState(0);

  // The latest server-provided response, and the screen key it was provided for.
  const [seed, setSeed] = useState(() => ({
    response: options.initialResponse,
    key: options.initialResponse ? key : null,
  }));
  if (options.initialResponse && options.initialResponse !== seed.response) {
    // A new response from the server (navigation or refresh): adopt it for the current key.
    setSeed({ response: options.initialResponse, key });
  }

  const cached = () => {
    const entry = config.cache === false ? undefined : cache.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.response : undefined;
  };
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
      if (response.cache && response.cache.maxAge > 0 && config.cache !== false) {
        cache.set(key, { response, expiresAt: Date.now() + response.cache.maxAge * 1000 });
      }
      setState((prev) => (prev.key === key && prev.response === response ? prev : { key, response, refreshing: false }));
      return;
    }

    const fresh = forced ? undefined : cached();
    if (fresh) {
      setState({ key, response: fresh, refreshing: false });
      return;
    }

    const controller = new AbortController();
    setState((prev) => (prev.key === key ? { ...prev, refreshing: true } : { key, refreshing: true }));
    (async () => {
      try {
        const response = await loadScreen(config, screen, latestParams.current, { signal: controller.signal });
        if (response.cache && response.cache.maxAge > 0) {
          cache.set(key, { response, expiresAt: Date.now() + response.cache.maxAge * 1000 });
        }
        if (!controller.signal.aborted) setState({ key, response, refreshing: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState((prev) => ({ key, response: prev.key === key ? prev.response : undefined, error, refreshing: false }));
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
    state.key === key ? state : { key, response: seeded ?? cached(), refreshing: seeded === undefined };
  const { response } = current;

  const islands = useMemo(
    () =>
      response
        ? plan(config.registry, response, { onError: config.renderIslandError, onSkipped: config.onSkipped })
        : [],
    [response, config],
  );

  const reload = useCallback(() => {
    force.current = true;
    setReloads((n) => n + 1);
  }, []);

  return {
    status: response ? "ready" : current.error !== undefined ? "error" : "loading",
    islands,
    response,
    error: current.error,
    refreshing: current.refreshing,
    reload,
  };
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
  return createElement(Suspense, { key, fallback: null }, createElement(IslandBoundary, { islandKey: key }, node));
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
  return JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
}
