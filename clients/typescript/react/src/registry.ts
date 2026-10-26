// No hooks or context here: the registry is used by Server Components and client code alike.

import { IslandRegistry } from "@client-compose/client";
import type { IslandDescriptor } from "@client-compose/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";

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
   * Render an island with a component whose props are the island's props:
   * `registry.registerComponent(ProfileHeaderV2, ProfileHeader)`.
   *
   * The component is rendered as an element (not called), so it can use hooks, and it can be a
   * Server Component or a Client Component. So can its placeholder.
   */
  registerComponent<P extends object>(
    island: IslandDescriptor<P>,
    component: ComponentType<P>,
    options: ComponentOptions = {},
  ): this {
    if (options.placeholder) {
      const placeholder = options.placeholder;
      this.registerPlaceholder(island, () => createElement(placeholder));
    }
    return this.register(island, (props) => createElement(component, props));
  }
}
