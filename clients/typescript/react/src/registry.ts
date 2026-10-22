// No hooks or context here: the registry is used by Server Components and client code alike.

import { IslandRegistry } from "@client-compose/client";
import type { IslandDescriptor } from "@client-compose/protocol";
import { type ComponentType, createElement, type ReactNode } from "react";

/** A registry whose islands render to React nodes. */
export class ReactIslandRegistry extends IslandRegistry<ReactNode> {
  /**
   * Render an island with a component whose props are the island's props:
   * `registry.registerComponent(ProfileHeaderV2, ProfileHeader)`.
   *
   * The component is rendered as an element (not called), so it can use hooks, and it can be a
   * Server Component or a Client Component.
   */
  registerComponent<P extends object>(
    island: IslandDescriptor<P>,
    component: ComponentType<P>,
  ): this {
    return this.register(island, (props) => createElement(component, props));
  }
}
