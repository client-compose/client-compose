"use client";

// An island's strings (spec §4.7) for the components inside it, not only the island's own: a Client
// Component inside a Server Component island can't be given `t`, which is made of functions, so it
// builds it here, in the browser, from the strings that can be sent.

import { buildStrings } from "@client-compose/client";
import type { IslandDescriptor, PluralRules, Strings } from "@client-compose/protocol";
import { createContext, createElement, type ReactNode, useContext, useMemo } from "react";

export interface IslandStringsValue {
  /** The island's type and version, to check a component asks for the island it's in. */
  type: string;
  version: number;
  /** Its strings, as its entry carries them. */
  strings?: Strings;
  plurals?: PluralRules;
}

const IslandStringsContext = createContext<IslandStringsValue | null>(null);

export interface IslandStringsProps extends IslandStringsValue {
  children?: ReactNode;
}

/** Gives the components inside an island its strings. The registry renders it around each island. */
export function IslandStrings(props: IslandStringsProps): ReactNode {
  const { type, version, strings, plurals, children } = props;
  const value = useMemo(
    () => ({
      type,
      version,
      strings,
      plurals,
    }),
    [type, version, strings, plurals],
  );
  return createElement(IslandStringsContext.Provider, { value }, children);
}

/**
 * The strings of the island a component is in, typed by its descriptor: the same `t` the island
 * gets. For a component inside an island, such as a Client Component inside a Server Component
 * island, which can't be passed `t`: `const t = useIslandStrings(ProfileHeaderV1)`.
 */
export function useIslandStrings<P, S>(descriptor: IslandDescriptor<P, S>): S {
  const island = useContext(IslandStringsContext);
  return useMemo(() => {
    if (!island) {
      throw new Error("useIslandStrings must be used inside an island");
    }
    if (island.type !== descriptor.type || island.version !== descriptor.version) {
      throw new Error(
        `useIslandStrings(${descriptor.type}@${descriptor.version}) is inside ${island.type}@${island.version}`,
      );
    }
    if (!descriptor.strings) {
      throw new Error(`${descriptor.type}@${descriptor.version} declares no strings`);
    }
    return buildStrings<S>(descriptor.strings, island.strings, island.plurals);
  }, [island, descriptor]);
}
