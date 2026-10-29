"use client";

// Islands a Server Component rendered, in the browser: what an action's changes and updates (spec
// §5.3) need there to reach them, or to say that only the server can show them.

import { buildStrings, type HeldEntity } from "@client-compose/client";
import type { IslandEntry, PluralRules, StringParams, Strings } from "@client-compose/protocol";
import {
  type ComponentType,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { EffectsBatch } from "./effects.ts";
import { IslandScopeContext } from "./pages.ts";
import { ClientComposeContext, type ScreenStore } from "./provider.ts";
import type { IslandScopeValue } from "./scope.ts";

/** An island's props, as its entry carries them. */
type Props = Record<string, unknown>;

export interface ClientIslandProps {
  component: ComponentType<object>;
  /** The island's props, as the server rendered them. */
  props: Props;
  /** Its declared strings, to build its `t` with, if it has any. */
  declared?: StringParams;
  strings?: Strings;
  plurals?: PluralRules;
}

/** What the island shows: what the server rendered (`from`), or what an action changed it to. */
interface Shown {
  from: Props;
  props: Props;
  strings?: Strings;
}

/**
 * What an island shows after an action: the same when the action doesn't touch it, or undefined
 * when only the server can show it (deleted where it can't be removed, an update this component
 * can't show, or its screen invalidated).
 */
function after(shown: Shown, batch: EffectsBatch, scope: IslandScopeValue): Shown | undefined {
  if (batch.invalidates(scope.screen, scope.params)) {
    return undefined;
  }

  const entry: IslandEntry = {
    key: scope.key,
    type: scope.type,
    version: scope.version,
    status: "ok",
    props: shown.props,
    ...(shown.strings && { strings: shown.strings }),
  };
  const next = batch.island(entry, scope.screen, scope.params);
  if (next === entry) {
    return shown;
  }

  if (next?.status !== "ok" || next.version !== scope.version) {
    return undefined;
  }

  return {
    from: shown.from,
    props: next.props,
    strings: next.strings,
  };
}

/** What the server rendered, before any action. */
function rendered(props: ClientIslandProps): Shown {
  return {
    from: props.props,
    props: props.props,
    strings: props.strings,
  };
}

/** Where an island stands once it's caught up with the actions it missed (`ScreenStore.missed`). */
interface CaughtUp {
  shown: Shown;
  /** The action it can't show, which only the server can: render it again. */
  stale?: EffectsBatch;
}

function caughtUp(
  screens: ScreenStore | undefined,
  scope: IslandScopeValue | null,
  props: ClientIslandProps,
): CaughtUp {
  let shown = rendered(props);
  if (!screens || !scope) {
    return { shown };
  }

  for (const batch of screens.missed(props.props)) {
    const next = after(shown, batch, scope);
    if (!next) {
      return { shown, stale: batch };
    }

    shown = next;
  }

  return { shown };
}

/**
 * A Client Component island a Server Component rendered. It takes an action's changes and updates
 * itself, as `useScreen` does, until the server renders it again. Shown again as it was (a router
 * brought its page back from its cache), it catches up with the actions it missed. Its `t` is made
 * of functions, which can't be sent to the browser, so it's built here from the strings that can.
 */
export function ClientIsland(props: ClientIslandProps): ReactNode {
  const { component, declared, plurals } = props;
  const context = useContext(ClientComposeContext);
  const screens = context?.screens;
  const onStale = context?.config.onStale;
  const scope = useContext(IslandScopeContext);
  const [start] = useState(() => caughtUp(screens, scope, props));
  const [changed, setChanged] = useState<Shown>(start.shown);
  // Rendered again by the server, it shows that instead.
  const shown = changed.from === props.props ? changed : rendered(props);
  const current = useRef(shown);

  useEffect(() => {
    current.current = shown;
  });

  useEffect(() => {
    if (start.stale) {
      onStale?.(start.stale.effects);
    }
  }, [start, onStale]);

  useEffect(() => {
    if (!screens || !scope) {
      return undefined;
    }

    return screens.watchRendered({
      screen: scope.screen,
      params: scope.params,
      apply: (batch) => {
        const next = after(current.current, batch, scope);
        if (!next) {
          return false;
        }

        if (next !== current.current) {
          current.current = next;
          setChanged(next);
        }

        return true;
      },
    });
  }, [screens, scope]);

  const t = useMemo(
    () => declared && buildStrings(declared, shown.strings, plurals),
    [declared, shown.strings, plurals],
  );
  const merged = useMemo(() => (t ? { ...shown.props, t } : shown.props), [shown.props, t]);

  return createElement(component, merged);
}

export interface ServerIslandProps {
  /** The entities its props hold, which an action's changes could change. */
  holds: HeldEntity[];
  children?: ReactNode;
}

/**
 * An island the browser can't change, such as a Server Component: it shows what the server
 * rendered, and when an action's changes or updates touch it, asks for the server to render it
 * again (the config's `onStale`).
 */
export function ServerIsland(props: ServerIslandProps): ReactNode {
  const { holds } = props;
  const context = useContext(ClientComposeContext);
  const screens = context?.screens;
  const onStale = context?.config.onStale;
  const scope = useContext(IslandScopeContext);

  useEffect(() => {
    if (!screens || !scope) {
      return undefined;
    }

    const touched = (batch: EffectsBatch) =>
      batch.invalidates(scope.screen, scope.params) ||
      batch.touches(holds, scope.screen, scope.params, scope.key);
    // Shown again as it was (its page brought back from a router's cache): did it miss an action
    // that touched it?
    const missed = screens.missed(holds).find(touched);
    if (missed) {
      onStale?.(missed.effects);
    }

    return screens.watchRendered({
      screen: scope.screen,
      params: scope.params,
      apply: (batch) => !batch.touches(holds, scope.screen, scope.params, scope.key),
    });
  }, [screens, scope, holds, onStale]);

  return props.children;
}
