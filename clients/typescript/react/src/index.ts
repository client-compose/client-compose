// React binding for Client Compose. Uses only React itself (no DOM APIs, no wrapper elements),
// so the same package works with React DOM, React Native and other React renderers.
//
// This entry is safe to import from React Server Components: the registry and loadScreen run
// anywhere, and the hooks and components come from a "use client" module. For rendering a screen
// in a Server Component, use "@client-compose/react/server". For tests, "@client-compose/react/testing".

export type { ClientComposeConfig, ErrorEntry, ScreenConfig } from "./config.ts";
export { loadScreen } from "./load.ts";
export { ReactIslandRegistry } from "./registry.ts";
// Re-exported so React apps (including codegen output) only need this one package.
export {
  type ActionResult,
  type ActionState,
  ComposedScreen,
  type ComposedScreenProps,
  Island,
  IslandBoundary,
  type ScreenState,
  useAction,
  useScreen,
  type UseScreenOptions,
} from "./client.ts";
export { type PagesState, type PagesStatus, usePages } from "./pages.ts";
export { ClientComposeProvider } from "./provider.ts";
export { type ProxyFunctions, type ProxyTransport, viaProxy } from "./proxy.ts";
export { declaredError, isUnexpected } from "./results.ts";
export { ActionFetchError, IslandFetchError } from "@client-compose/client";
export type {
  ActionDescriptor,
  ActionEffects,
  ActionRequest,
  ActionResponse,
  DeclaredError,
  IslandDescriptor,
  IslandEntry,
  IslandError,
  ScreenMeta,
  ScreenRef,
  ScreenResponse,
} from "@client-compose/protocol";
