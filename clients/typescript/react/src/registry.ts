// No hooks or context here: the registry is used by Server Components and client code alike.

import { IslandRegistry, type WithStrings } from "@client-compose/client";
import type { IslandDescriptor } from "@client-compose/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";

// From a Server Component, a client reference: rendered, never called.
import { ClientIsland } from "./rendered.ts";

export interface ComponentOptions {
  /**
   * Shown while the island is pending in a screen's stream (spec §4.6), until it arrives: usually
   * a skeleton the island's size, so the screen doesn't jump. It has no props. Without one,
   * nothing is shown. Say that it's loading (e.g. `aria-busy`): the placeholder is all there is.
   */
  placeholder?: ComponentType;
}

/** A registry whose islands render to React nodes. */
export class ReactIslandRegistry extends IslandRegistry<ReactNode> {
  /**
   * Render an island with a component whose props are the island's props, and its strings as `t`
   * if it declares any: `registry.registerComponent(ProfileHeaderV2, ProfileHeader)`.
   *
   * The component is rendered as an element (not called), so it can use hooks, and it can be a
   * Server Component or a Client Component. So can its placeholder.
   */
  registerComponent<P extends object, S>(
    island: IslandDescriptor<P, S>,
    component: ComponentType<WithStrings<P, S>>,
    options: ComponentOptions = {},
  ): this {
    if (options.placeholder) {
      const placeholder = options.placeholder;
      this.registerPlaceholder(island, () => createElement(placeholder));
    }
    const declared = island.strings;
    return this.register(island, (props, entry, plurals) => {
      if (isClientReference(component)) {
        // A Server Component is rendering a Client Component: the browser builds its `t`, and
        // applies actions' changes to it.
        return createElement(ClientIsland, {
          component,
          props: isRecord(entry.props) ? entry.props : {},
          ...(declared && { declared }),
          ...(entry.strings && { strings: entry.strings }),
          ...(plurals && { plurals }),
        });
      }
      return createElement(component, props);
    });
  }
}

/** A Client Component, as a Server Component sees it: a reference to a module in the browser. */
function isClientReference(component: unknown): component is ComponentType<object> {
  return (
    (typeof component === "function" || isRecord(component)) &&
    Reflect.get(component, "$$typeof") === Symbol.for("react.client.reference")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
