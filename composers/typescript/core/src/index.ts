// Framework-agnostic composer: declare screens and actions, add plugins, and serve them with
// `composer.fetch` or an adapter (node:http, Express, Fastify).

export {
  type Action,
  action,
  type ActionContext,
  type ActionOptions,
  type ActionOutcome,
} from "./actions.ts";
export { type Cache, type IslandCache } from "./adapters.ts";
export {
  type Composer,
  type ComposerConfig,
  createComposer,
  type HandleResult,
  matchRoute,
} from "./composer.ts";
export { conformanceActions, conformanceScreen } from "./conformance.ts";
export {
  type BatchLoader,
  type BatchLoaderOptions,
  defineBatchLoader,
  ForbiddenError,
  type LoadContext,
  LoadNotFoundError,
  NotFoundError,
  UnauthenticatedError,
} from "./loading.ts";
export {
  type ComposeFn,
  type Failure,
  type IslandCall,
  type PerformFn,
  type Plugin,
  reportErrors,
  type Requirement,
  type RequirementRequest,
  type ResolveFn,
} from "./plugins.ts";
export type { ComposeResult, PerformResult } from "./results.ts";
export {
  type Island,
  island,
  type IslandOptions,
  type LayoutContext,
  negotiate,
  place,
  type Placement,
  type PlaceOptions,
  placeStatic,
  type ResolveContext,
  type Screen,
  screen,
} from "./screens.ts";

// The protocol's types, so server code (and generated descriptors, with codegen's
// `"protocolImport": "@client-compose/composer"`) need only this package.
export {
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
  PROTOCOL_VERSION,
  type ScreenErrorResponse,
  type ScreenMeta,
  type ScreenRef,
  screenRefMatches,
  type ScreenRequest,
  type ScreenResponse,
} from "@client-compose/protocol";
