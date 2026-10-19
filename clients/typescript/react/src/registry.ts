// No hooks or context here: the registry is used by Server Components and client code alike.

import { createElement, type ComponentType, type ReactNode } from "react";
import { IslandRegistry } from "@client-compose/client";
import type { IslandDescriptor } from "@client-compose/protocol";

/** A registry whose islands render to React nodes. */
export class ReactIslandRegistry extends IslandRegistry<ReactNode> {
  /**
   * Render an island with a component whose props are the island's props:
   * `registry.registerComponent(ProfileHeaderV2, ProfileHeader)`.
   *
   * The component is rendered as an element (not called), so it can use hooks, and it can be a
   * Server Component or a Client Component.
   */
  registerComponent<P>(island: IslandDescriptor<P>, component: ComponentType<P>): this {
    return this.register(island, (props) => createElement(component as ComponentType<any>, props as any));
  }
}
