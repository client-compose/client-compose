// Framework-agnostic composer: declare screens and actions, add plugins, and serve them with
// `composer.fetch` or an adapter (node:http, Express, Fastify).

export { createComposer, matchRoute, type Composer, type ComposerConfig, type HandleResult } from "./composer.ts";
export {
  island,
  negotiate,
  place,
  placeStatic,
  screen,
  type Island,
  type LayoutContext,
  type PlaceOptions,
  type Placement,
  type ResolveContext,
  type Screen,
} from "./screens.ts";
export { action, type Action, type ActionContext, type ActionOptions, type ActionOutcome } from "./actions.ts";
export {
  reportErrors,
  type ComposeFn,
  type Failure,
  type IslandCall,
  type PerformFn,
  type Plugin,
  type Requirement,
  type ResolveFn,
} from "./plugins.ts";
export type { ComposeResult, PerformResult } from "./results.ts";
export {
  defineBatchLoader,
  ForbiddenError,
  LoadNotFoundError,
  NotFoundError,
  UnauthenticatedError,
  type BatchLoader,
  type BatchLoaderOptions,
  type LoadContext,
} from "./loading.ts";
export { conformanceActions, conformanceScreen } from "./conformance.ts";

// The protocol's types, so server code (and generated descriptors, with codegen's
// `"protocolImport": "@client-compose/composer"`) need only this package.
export {
  PROTOCOL_VERSION,
  screenRefMatches,
  type ActionDescriptor,
  type ActionEffects,
  type ActionRequest,
  type ActionResponse,
  type Capabilities,
  type ClientContext,
  type DeclaredError,
  type IslandDescriptor,
  type IslandEntry,
  type IslandError,
  type ScreenErrorResponse,
  type ScreenMeta,
  type ScreenRef,
  type ScreenRequest,
  type ScreenResponse,
} from "@client-compose/protocol";
