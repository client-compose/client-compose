// React binding for Client Compose. Uses only React itself (no DOM APIs, no wrapper elements),
// so the same package works with React DOM, React Native and other React renderers.
//
// This entry is safe to import from React Server Components: the registry and loadScreen run
// anywhere, and the hooks and components come from a "use client" module. For rendering a screen
// in a Server Component, use "@client-compose/react/server". For tests, "@client-compose/react/testing".

export type { ClientComposeConfig, ErrorEntry, ScreenConfig } from "./config.ts";
export { loadScreen, streamScreen } from "./load.ts";
export { type ComponentOptions, ReactIslandRegistry } from "./registry.ts";
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
export { richText } from "./rich.ts";
export {
  AppStringsProvider,
  type AppStringsProviderProps,
  type StringsCache,
  useAppStrings,
  useLocale,
} from "./strings.ts";
export {
  ActionFetchError,
  appStrings,
  formatString,
  IslandFetchError,
  type IslandProps,
  preferredLocale,
  type ScreenStream,
  StringsFetchError,
  type WithStrings,
} from "@client-compose/client";
export type {
  ActionDescriptor,
  ActionEffects,
  ActionRequest,
  ActionResponse,
  AppStringsDescriptor,
  DeclaredError,
  IslandDescriptor,
  IslandEntry,
  IslandError,
  PendingIsland,
  ScreenHead,
  ScreenMeta,
  ScreenRef,
  ScreenResponse,
  ScreenStringsDescriptor,
  StringsResponse,
} from "@client-compose/protocol";
