// Extension points (spec/CAPABILITIES.md): requirements, plugins and failure reports.

import type { ActionRequest, ClientContext, ScreenRequest } from "@client-compose/protocol";

import type { ComposeResult, PerformResult } from "./results.ts";
import type { Island, ResolveContext } from "./screens.ts";

/** What a requirement sees of the request besides the context. */
export interface RequirementRequest {
  /** The screen being composed; undefined for an action. */
  screen?: string;
  /** The screen's params; empty for an action, which checks its input itself. */
  params: Record<string, string>;
  client: ClientContext;
}

/**
 * Must hold before a screen's islands or an action's handler run (CMP-16). Throw
 * UnauthenticatedError, ForbiddenError or NotFoundError and the client gets 401, 403 or 404.
 * Requirements read what your `context` function put on the context and, for screens, the params:
 *
 *     const signedIn: Requirement<Ctx> = (ctx) => {
 *       if (!ctx.viewer) throw new UnauthenticatedError();
 *     };
 *
 *     // 404 for a recipe that doesn't exist, 403 unless the viewer may edit it.
 *     const editsRecipe: Requirement<Ctx> = async (ctx, { params }) => {
 *       await recipes.editable(ctx.viewer, params.recipeId);
 *     };
 */
export type Requirement<Ctx> = (ctx: Ctx, request: RequirementRequest) => void | Promise<void>;

/** Composes a screen. */
export type ComposeFn<Ctx> = (req: ScreenRequest, ctx: Ctx) => Promise<ComposeResult>;

/** Performs an action. */
export type PerformFn<Ctx> = (req: ActionRequest, ctx: Ctx) => Promise<PerformResult>;

/** One island version being resolved on a screen. */
export interface IslandCall<Ctx> {
  screen: string;
  /** The island's key on the screen. */
  key: string;
  island: Island<Ctx, unknown>;
  rc: ResolveContext<Ctx>;
}

/** Resolves one island version's props. */
export type ResolveFn<Ctx> = (call: IslandCall<Ctx>) => Promise<unknown>;

/** Something that went wrong while answering a request. */
export interface Failure {
  kind: "island" | "layout" | "meta" | "action" | "context";
  /** Set for island, layout and meta failures. */
  screen?: string;
  /** Set for island failures. */
  key?: string;
  type?: string;
  /** Set for action failures. */
  action?: string;
  version?: number;
  error: unknown;
}

/**
 * Hooks into a composer. Set the hooks you need. Plugins run in the order they're listed in `use`:
 * the first is the outermost.
 *
 *     const tracing: Plugin<Ctx> = {
 *       island: (next) => async (call) => {
 *         const span = tracer.startSpan(call.island.type);
 *         try { return await next(call); } finally { span.end(); }
 *       },
 *     };
 */
export interface Plugin<Ctx, Req = unknown> {
  /**
   * Runs once per HTTP request, after the composer's own `context` function, and adds to the
   * context: the viewer from a token, a tenant. Throw UnauthenticatedError or ForbiddenError to
   * answer 401 or 403 straight away.
   */
  context?: (request: Req, ctx: Ctx) => Partial<Ctx> | void | Promise<Partial<Ctx> | void>;
  /** Wraps composing a whole screen: requirements, layout, islands and meta. */
  screen?: (next: ComposeFn<Ctx>) => ComposeFn<Ctx>;
  /** Wraps resolving one island version. */
  island?: (next: ResolveFn<Ctx>) => ResolveFn<Ctx>;
  /** Wraps performing an action: requirements, input validation and the handler. */
  action?: (next: PerformFn<Ctx>) => PerformFn<Ctx>;
  /**
   * Told about every failure: an island, a layout, a screen's meta, an action or a context function.
   * The client has already been answered; this is for logs and error tracking.
   */
  error?: (failure: Failure) => void;
}

/**
 * A plugin that passes every failure to `report`, e.g. to log it. It has only an `error` hook, so it
 * fits any composer whatever its context and request types.
 */
export function reportErrors(report: (failure: Failure) => void): {
  error: (failure: Failure) => void;
} {
  return { error: report };
}
