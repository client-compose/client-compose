// Framework-agnostic composer: declare screens and actions, add plugins, and serve them with
// `composer.fetch` or an adapter (node:http, Express, Fastify).

export {
  type Action,
  action,
  type ActionContext,
  type ActionOptions,
  type ActionOutcome,
} from "./actions.ts";
export {
  type Cache,
  type Idempotency,
  type IdempotencyStore,
  type IslandCache,
} from "./adapters.ts";
export {
  type Composer,
  type ComposerConfig,
  createComposer,
  type HandleResult,
  matchRoute,
  type Route,
} from "./composer.ts";
export { conformanceActions, conformanceScreen } from "./conformance.ts";
export {
  type BatchLoader,
  type BatchLoaderOptions,
  defineBatchLoader,
  ForbiddenError,
  InvalidCursorError,
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
export type { ComposeResult, IslandResult, PerformResult, StringsResult } from "./results.ts";
export {
  type Island,
  island,
  type IslandOptions,
  type LayoutContext,
  negotiate,
  type Page,
  pagedIsland,
  place,
  type Placement,
  type PlaceOptions,
  placeStatic,
  type ResolveContext,
  type Screen,
  screen,
} from "./screens.ts";
export { collect, type ScreenStream } from "./stream.ts";
export {
  type Catalog,
  type CatalogFile,
  loadCatalog,
  type LocaleStrings,
  type StringsConfig,
  stringsFor,
} from "./strings.ts";

// The protocol's types, so server code (and generated descriptors, with codegen's
// `"protocolImport": "@client-compose/composer"`) need only this package.
export {
  type ActionDescriptor,
  type ActionEffects,
  type ActionRequest,
  type ActionResponse,
  type AppStringsDescriptor,
  type Capabilities,
  type ClientContext,
  type DeclaredError,
  type IslandDescriptor,
  type IslandEntry,
  type IslandError,
  type IslandRequest,
  type IslandResponse,
  type PluralRules,
  PROTOCOL_VERSION,
  type ScreenErrorResponse,
  type ScreenMeta,
  type ScreenRef,
  screenRefMatches,
  type ScreenRequest,
  type ScreenResponse,
  type StringParams,
  type Strings,
  type StringsRequest,
  type StringsResponse,
  type StringTemplate,
} from "@client-compose/protocol";
