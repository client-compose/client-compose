// React binding for Client Compose. Uses only React itself (no DOM APIs, no wrapper elements),
// so the same package works with React DOM, React Native and other React renderers.

import {
  Component,
  createContext,
  createElement,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  buildRequest,
  fetchScreen,
  IslandRegistry,
  plan,
  type PlannedIsland,
  type SkipReason,
} from "@client-compose/client";
import type { ClientContext, IslandDescriptor, IslandEntry, ScreenResponse } from "@client-compose/protocol";

type ErrorEntry = IslandEntry & { status: "error" };

/** A registry whose islands render to React nodes. */
export class ReactIslandRegistry extends IslandRegistry<ReactNode> {
  /**
   * Render an island with a component whose props are the island's props:
   * `registry.registerComponent(ProfileHeaderV2, ProfileHeader)`.
   *
   * The component is rendered as an element (not called), so it can use hooks.
   */
  registerComponent<P>(island: IslandDescriptor<P>, component: ComponentType<P>): this {
    return this.register(island, (props) => createElement(component as ComponentType<any>, props as any));
  }
}

export interface ClientComposeConfig {
  registry: IslandRegistry<ReactNode>;
  /** Composer base URL; requests go to `${baseUrl}/screens/{screen}`. */
  baseUrl: string;
  client: ClientContext;
  /** Extra headers per request, e.g. `Authorization`. May be async (token refresh). */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Render a fallback for islands the composer marked as errored. Default: omit them. */
  renderIslandError?: (entry: ErrorEntry) => ReactNode;
  /** Islands the client couldn't render (unknown type, version or status). */
  onSkipped?: (entry: IslandEntry, reason: SkipReason) => void;
  /** An island component threw while rendering. The island is hidden; the rest of the screen stays. */
  onRenderError?: (key: string, error: unknown) => void;
  /** Reuse responses for `cache.maxAge` seconds, as the composer allows. Default: true. */
  cache?: boolean;
}

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

interface FetchState {
  key: string;
  response?: ScreenResponse;
  error?: unknown;
  refreshing: boolean;
}

/** Fetch and plan a screen. Use this directly for custom layouts (e.g. a React Native FlatList). */
export function useScreen(screen: string, params: Record<string, string> = {}): ScreenState {
  const { config, cache } = useClientCompose();
  const key = `${screen}?${stableKey(params)}`;
  const latestParams = useRef(params);
  latestParams.current = params;
  const force = useRef(false);
  const [reloads, setReloads] = useState(0);

  const cached = () => {
    const entry = config.cache === false ? undefined : cache.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.response : undefined;
  };
  const [state, setState] = useState<FetchState>(() => ({ key, response: cached(), refreshing: false }));

  useEffect(() => {
    const forced = force.current;
    force.current = false;
    const fresh = forced ? undefined : cached();
    if (fresh) {
      setState({ key, response: fresh, refreshing: false });
      return;
    }

    const controller = new AbortController();
    setState((prev) => (prev.key === key ? { ...prev, refreshing: true } : { key, refreshing: true }));
    (async () => {
      try {
        const headers = await config.headers?.();
        const request = buildRequest(config.registry, screen, config.client, latestParams.current);
        const response = await fetchScreen(config.baseUrl, request, { headers, signal: controller.signal }, config.fetch);
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
    // `key` covers screen and params; config changes (e.g. a new registry) refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloads, config]);

  // Until the effect for a new key runs, don't show the previous key's islands.
  const current: FetchState = state.key === key ? state : { key, response: cached(), refreshing: true };
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
  onError?: (key: string, error: unknown) => void;
  children?: ReactNode;
}

class IslandBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError?.(this.props.islandKey, error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function IslandContent(props: { island: PlannedIsland<ReactNode> }): ReactNode {
  // Rendering inside the boundary means a throwing renderer is caught too.
  return props.island.render();
}

/** Render one planned island inside its own error boundary. */
export function Island(props: { island: PlannedIsland<ReactNode> }): ReactNode {
  const { config } = useClientCompose();
  return createElement(
    IslandBoundary,
    { islandKey: props.island.key, onError: config.onRenderError },
    createElement(IslandContent, { island: props.island }),
  );
}

export interface ComposedScreenProps {
  screen: string;
  params?: Record<string, string>;
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
  const screen = useScreen(props.screen, props.params);
  if (screen.status === "loading") return props.loading ?? null;
  if (screen.status === "error") return props.renderError?.(screen.error, screen.reload) ?? null;
  const nodes = screen.islands.map((island) => createElement(Island, { key: island.key, island }));
  return props.children ? props.children(nodes, screen) : createElement(Fragment, null, ...nodes);
}

function stableKey(params: Record<string, string>): string {
  return JSON.stringify(Object.keys(params).sort().map((k) => [k, params[k]]));
}
