// React binding for Client Compose. Uses only React itself (no DOM APIs, no wrapper elements),
// so the same package works with React DOM, React Native and other React renderers.
//
// This entry is safe to import from React Server Components: the registry and loadScreen run
// anywhere, and the hooks and components come from a "use client" module. For rendering a screen
// in a Server Component, use "@client-compose/react/server".

export { ReactIslandRegistry } from "./registry.ts";
export { loadScreen } from "./load.ts";
export type { ClientComposeConfig, ErrorEntry, ScreenConfig } from "./config.ts";
// Re-exported so React apps (including codegen output) only need this one package.
export type { IslandDescriptor, ScreenMeta, ScreenResponse } from "@client-compose/protocol";
export {
  ClientComposeProvider,
  ComposedScreen,
  Island,
  IslandBoundary,
  useScreen,
  type ComposedScreenProps,
  type ScreenState,
  type UseScreenOptions,
} from "./client.ts";
