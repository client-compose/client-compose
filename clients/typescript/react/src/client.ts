"use client";

// Everything that needs React state, effects or context. Marked "use client" so that, in React
// Server Components, importing the package from a Server Component treats these as Client
// Components instead of running them on the server.

import {
  buildActionRequest,
  checkActionResponse,
  collectScreen,
  fetchAction,
  newIdempotencyKey,
  plan,
  type PlannedIsland,
  withIsland,
} from "@client-compose/client";
import {
  type ActionDescriptor,
  type ActionResponse,
  type DeclaredError,
  type IslandEntry,
  type ScreenHead,
  type ScreenResponse,
} from "@client-compose/protocol";
import {
  Component,
  createElement,
  Fragment,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { streamScreen } from "./load.ts";
import { scopeIslands } from "./pages.ts";
import { ClientComposeContext, isContextValue, useClientCompose } from "./provider.ts";

export interface ScreenState {
  /** `loading` until the first response; `error` only if there's nothing to show. */
  status: "loading" | "ready" | "error";
  islands: PlannedIsland<ReactNode>[];
  /** The screen so far: while it streams in, its islands still on their way are `pending`. */
  response?: ScreenHead;
  /** Islands are still on their way (spec §4.6). */
  streaming: boolean;
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
  /**
   * Show the screen as it streams in (the default, unless the config's `progressive` is false), or
   * wait for all of it.
   */
  progressive?: boolean;
}

interface FetchState {
  key: string;
  response?: ScreenHead;
  error?: unknown;
  refreshing: boolean;
  /** Islands are still on their way. */
  streaming?: boolean;
}

/** The last response the server passed (`initialResponse`) that the screen took, and its key. */
interface Taken {
  key: string;
  response?: ScreenResponse;
}

/** Fetch and plan a screen. Use this directly for custom layouts (e.g. a React Native FlatList). */
export function useScreen(
  screen: string,
  params: Record<string, string> = {},
  options: UseScreenOptions = {},
): ScreenState {
  const key = `${screen}?${stableKey(params)}`;
  // The same object for as long as the params are the same, whatever object the caller passes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const screenParams = useMemo(() => params, [key]);
  const { current, reload } = useScreenResponse({
    screen,
    key,
    params: screenParams,
    initialResponse: options.initialResponse,
    progressive: options.progressive,
  });
  const islands = usePlannedIslands(current.response, screenParams);
  useReloadWhenInvalidated(screen, screenParams, reload);

  return {
    status: screenStatus(current.response, current.error),
    islands,
    response: current.response,
    error: current.error,
    refreshing: current.refreshing,
    streaming: current.streaming ?? false,
    reload,
  };
}

interface ScreenResponseOptions {
  screen: string;
  key: string;
  params: Record<string, string>;
  initialResponse: ScreenResponse | undefined;
  progressive: boolean | undefined;
}

/**
 * The screen's response: the server's (`initialResponse`), a cached one, or one fetched for it,
 * and fetched again on `reload`. A response the server passes with a render is for that render's
 * screen and params; it stays theirs, so the screen opened with other params never shows it.
 */
function useScreenResponse(options: ScreenResponseOptions): {
  current: FetchState;
  reload: () => void;
} {
  const { screen, key, params, initialResponse } = options;
  const { config, screens } = useClientCompose();
  const progressive = options.progressive ?? config.progressive ?? true;
  // Set by reload, read once by the effect it re-runs: never in render.
  const forceNext = useRef(false);
  const [reloads, setReloads] = useState(0);
  const cached = () => (config.cache === false ? undefined : screens.cached(key));
  const [state, setState] = useState<FetchState>(() => ({
    key,
    response: initialResponse ?? cached(),
    refreshing: false,
  }));
  const [taken, setTaken] = useState<Taken>(() => ({ key, response: initialResponse }));
  const fromServer = serverResponseFor(key, taken, initialResponse);

  useEffect(() => {
    const forced = forceNext.current;
    forceNext.current = false;
    if (!forced && fromServer) {
      // Use the server's response without a request (StrictMode remounts land here too).
      if (config.cache !== false) {
        screens.remember(key, screen, params, fromServer);
      }
      setTaken((prev) =>
        prev.key === key && prev.response === fromServer ? prev : { key, response: fromServer },
      );
      setState((prev) =>
        prev.key === key && prev.response === fromServer ? prev : settled(key, fromServer),
      );
      return undefined;
    }
    const fresh = forced ? undefined : cached();
    const controller = new AbortController();
    void loadInto(controller.signal, fresh);
    return () => controller.abort();
    // `key` covers screen and params; a new server response or config (e.g. a new registry) re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloads, config, fromServer]);

  /** Shows a cached response, or loads the screen; a failure keeps what's shown, with the error. */
  async function loadInto(signal: AbortSignal, fresh: ScreenResponse | undefined) {
    if (fresh) {
      setState(settled(key, fresh));
      return;
    }
    setState((prev) =>
      prev.key === key ? { ...prev, refreshing: true } : { key, refreshing: true },
    );
    try {
      const stream = await streamScreen(config, screen, params, { signal });
      const response = progressive
        ? await showAsItArrives(stream, (shown) => !signal.aborted && setState(shown))
        : await collectScreen(stream);
      screens.remember(key, screen, params, response);
      if (!signal.aborted) {
        setState(settled(key, response));
      }
    } catch (error) {
      if (!signal.aborted) {
        setState((prev) => ({
          key,
          response: prev.key === key ? prev.response : undefined,
          error,
          refreshing: false,
        }));
      }
    }
  }

  /**
   * Shows the head, then each island as it arrives, and resolves with the whole screen. Until a
   * pending island arrives, one the screen already shows stays as it is (a reload doesn't flash
   * back to placeholders).
   */
  async function showAsItArrives(
    stream: { head: ScreenHead; islands: AsyncIterable<IslandEntry> },
    show: (state: (prev: FetchState) => FetchState) => void,
  ): Promise<ScreenResponse> {
    let head = stream.head;
    show((prev) => streamingState(key, head, prev));
    for await (const entry of stream.islands) {
      head = withIsland(head, entry);
      const now = head;
      show((prev) => streamingState(key, now, prev));
    }
    return completeScreen(head);
  }

  const reload = useCallback(() => {
    forceNext.current = true;
    setReloads((n) => n + 1);
  }, []);

  // Until the effect for a new key runs, show the server's response for it if there is one, and
  // never the previous key's islands.
  const current: FetchState =
    state.key === key
      ? state
      : {
          key,
          response: fromServer ?? cached(),
          refreshing: fromServer === undefined,
        };
  return { current, reload };
}

/**
 * The server's response for this key: one passed with this render that the screen hasn't taken
 * yet is for it; otherwise the one it took, if it took it for this key.
 */
function serverResponseFor(
  key: string,
  taken: Taken,
  initialResponse: ScreenResponse | undefined,
): ScreenResponse | undefined {
  if (initialResponse !== undefined && initialResponse !== taken.response) {
    return initialResponse;
  }
  return taken.key === key ? taken.response : undefined;
}

/** The screen while it streams: the head so far, keeping what was shown for islands still pending. */
function streamingState(key: string, head: ScreenHead, prev: FetchState): FetchState {
  const before = prev.key === key ? prev.response?.islands : undefined;
  const islands = head.islands.map((e) => {
    if (e.status !== "pending") {
      return e;
    }
    const shown = before?.find((b) => b.key === e.key && b.status === "ok" && b.type === e.type);
    return shown ?? e;
  });
  return {
    key,
    response: { ...head, islands },
    refreshing: true,
    streaming: head.islands.some((e) => e.status === "pending"),
  };
}

/** A head with nothing pending, as the screen it is. */
function completeScreen(head: ScreenHead): ScreenResponse {
  return { ...head, islands: head.islands.filter((e): e is IslandEntry => e.status !== "pending") };
}

function settled(key: string, response: ScreenResponse): FetchState {
  return {
    key,
    response,
    refreshing: false,
  };
}

/** The screen's islands to render, in order, each knowing where it is (for its pages). */
function usePlannedIslands(
  response: ScreenHead | undefined,
  params: Record<string, string>,
): PlannedIsland<ReactNode>[] {
  const { config } = useClientCompose();
  return useMemo(() => {
    if (!response) {
      return [];
    }
    const planned = plan(config.registry, response, {
      onError: config.renderIslandError,
      onSkipped: config.onSkipped,
    });
    return scopeIslands(planned, response, params);
    // A response is for one screen and params, so it plans the same whatever params are now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, config]);
}

/** Lets actions that change this screen reload it (spec §5.3). */
function useReloadWhenInvalidated(
  screen: string,
  params: Record<string, string>,
  reload: () => void,
): void {
  const { screens } = useClientCompose();
  useEffect(
    () =>
      screens.mount({
        screen,
        params,
        reload,
      }),
    [screen, params, screens, reload],
  );
}

function screenStatus(response: ScreenHead | undefined, error: unknown): ScreenState["status"] {
  if (response) {
    return "ready";
  }
  return error !== undefined ? "error" : "loading";
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
    if (isContextValue(this.context)) {
      this.context.config.onRenderError?.(this.props.islandKey, error);
    }
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
  /** Show it as it streams in, or wait for all of it (see `UseScreenOptions.progressive`). */
  progressive?: boolean;
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
  const screen = useScreen(props.screen, props.params, {
    initialResponse: props.initialResponse,
    progressive: props.progressive,
  });
  if (screen.status === "loading") {
    return props.loading ?? null;
  }
  if (screen.status === "error") {
    return props.renderError?.(screen.error, screen.reload) ?? null;
  }
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
        if (outcome.status === "ok" && outcome.effects) {
          applyEffects(outcome.effects);
        }
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
  return {
    run,
    pending: inFlight > 0,
    last,
    reset,
  };
}
