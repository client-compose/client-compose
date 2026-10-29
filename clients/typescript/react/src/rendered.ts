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

import { IslandScopeContext } from "./pages.ts";
import { ClientComposeContext } from "./provider.ts";

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
 * A Client Component island a Server Component rendered. It takes an action's changes and updates
 * itself, as `useScreen` does, until the server renders it again. Its `t` is made of functions,
 * which can't be sent to the browser, so it's built here from the strings that can.
 */
export function ClientIsland(props: ClientIslandProps): ReactNode {
  const { component, declared, plurals } = props;
  const screens = useContext(ClientComposeContext)?.screens;
  const scope = useContext(IslandScopeContext);
  const [changed, setChanged] = useState<Shown>();
  // Rendered again by the server, it shows that instead.
  const shown: Shown =
    changed?.from === props.props
      ? changed
      : {
          from: props.props,
          props: props.props,
          strings: props.strings,
        };
  const current = useRef(shown);

  useEffect(() => {
    current.current = shown;
  });

  useEffect(() => {
    if (!screens || !scope) {
      return undefined;
    }

    return screens.watchRendered((batch) => {
      const { from, strings } = current.current;
      const entry: IslandEntry = {
        key: scope.key,
        type: scope.type,
        version: scope.version,
        status: "ok",
        props: current.current.props,
        ...(strings && { strings }),
      };
      const next = batch.island(entry, scope.screen, scope.params);
      if (next === entry) {
        return true;
      }

      // Deleted where it can't be removed, or an update this component can't show.
      if (next?.status !== "ok" || next.version !== scope.version) {
        return false;
      }

      current.current = {
        from,
        props: next.props,
        strings: next.strings,
      };
      setChanged(current.current);

      return true;
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
 * again (the config's `onChanges`).
 */
export function ServerIsland(props: ServerIslandProps): ReactNode {
  const { holds } = props;
  const screens = useContext(ClientComposeContext)?.screens;
  const scope = useContext(IslandScopeContext);

  useEffect(() => {
    if (!screens || !scope) {
      return undefined;
    }

    return screens.watchRendered(
      (batch) => !batch.touches(holds, scope.screen, scope.params, scope.key),
    );
  }, [screens, scope, holds]);

  return props.children;
}
