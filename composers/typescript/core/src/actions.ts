// Actions (spec §5): typed calls that change something. Like the composer, framework-agnostic:
// adapters hand performHttp() the path's action name and the raw body, then write the result.

import {
  PROTOCOL_VERSION,
  type ActionDescriptor,
  type ActionEffects,
  type ActionRequest,
  type ActionResponse,
  type ClientContext,
  type DeclaredError,
  type ScreenErrorResponse,
} from "@client-compose/protocol";

import { attachScope, ForbiddenError, NotFoundError, RequestScope, UnauthenticatedError, type LoadContext } from "./loading.ts";
import { validate } from "./validate.ts";

export interface ActionContext<Ctx> extends LoadContext {
  client: ClientContext;
  /** Whatever the adapter injects: auth, service clients, tracing. */
  ctx: Ctx;
  /**
   * The client's key for this user intent, if it sent one (spec §5.2). Honouring it (returning the
   * first outcome again instead of repeating the change) is up to the action.
   */
  idempotencyKey?: string;
  /** Aborted when the request is done. */
  signal: AbortSignal;
  /** Request-scoped load, as in resolvers: runs `fn` once per key for this request. */
  load: <T>(key: string, fn: (signal: AbortSignal) => Promise<T> | T) => Promise<T>;
}

/** What an action returns: a result (and optionally its effects), or one of its declared errors. */
export type ActionOutcome<R, E extends DeclaredError> = { result: R; effects?: ActionEffects } | { error: E };

/** One action version and how to perform it. Build one with defineAction. */
export interface ActionHandler<Ctx, I = any, R = any, E extends DeclaredError = any> {
  descriptor: ActionDescriptor<I, R, E>;
  perform: (input: I, ac: ActionContext<Ctx>) => Promise<ActionOutcome<R, E>> | ActionOutcome<R, E>;
}

/**
 * Define how to perform one action version, with its generated descriptor:
 *
 *     defineAction(FollowUserV1, async ({ userId }, { ctx }) => {
 *       if (await ctx.blocks.has(userId, ctx.user)) return { error: { code: "blocked" } };
 *       const followers = await ctx.follows.add(ctx.user, userId);
 *       return { result: { followers }, effects: { invalidate: [{ screen: "profile", params: { userId } }] } };
 *     });
 *
 * Throw NotFoundError, UnauthenticatedError or ForbiddenError for those protocol errors. Anything
 * else thrown is a failure: the client gets 500 `action_failed`.
 */
export function defineAction<I, R, E extends DeclaredError, Ctx = unknown>(
  descriptor: ActionDescriptor<I, R, E>,
  perform: ActionHandler<Ctx, I, R, E>["perform"],
): ActionHandler<Ctx, I, R, E> {
  return { descriptor, perform };
}

export type PerformResult =
  | { status: 200; body: ActionResponse }
  | { status: 400 | 401 | 403 | 404 | 500; body: ScreenErrorResponse };

export interface ActionsOptions {
  /**
   * An action threw (other than a protocol error), or returned an error code it doesn't declare.
   * The client gets 500 `action_failed`.
   */
  onActionError?: (action: string, version: number, err: unknown) => void;
}

const fail = (status: 400 | 401 | 403 | 404 | 500, code: string, message?: string): PerformResult => ({
  status,
  body: { protocol: PROTOCOL_VERSION, error: { code, message } },
});

class UndeclaredErrorCode extends Error {}

export function createActions<Ctx>(actions: ActionHandler<Ctx>[], options: ActionsOptions = {}) {
  const byName = new Map<string, Map<number, ActionHandler<Ctx>>>();
  for (const a of actions) {
    const { action, version } = a.descriptor;
    if (!byName.has(action)) byName.set(action, new Map());
    if (byName.get(action)!.has(version)) throw new Error(`Action ${action} v${version} is defined twice`);
    byName.get(action)!.set(version, a);
  }

  return async function perform(req: ActionRequest, ctx: Ctx): Promise<PerformResult> {
    if (req.protocol !== PROTOCOL_VERSION) {
      return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
    }
    const versions = byName.get(req.action);
    if (!versions) return fail(404, "unknown_action", req.action);
    const handler = versions.get(req.version);
    if (!handler) return fail(404, "unsupported_action_version", `${req.action} v${req.version}`);
    const { descriptor } = handler;
    const input = validate(descriptor.input, req.input);
    if (!input.ok) return fail(400, "invalid_input", input.message);

    const request = new AbortController();
    const scope = new RequestScope(request.signal);
    const ac = attachScope(
      {
        client: req.client,
        ctx,
        idempotencyKey: req.idempotencyKey,
        signal: request.signal,
        load: scope.load.bind(scope),
      },
      scope,
    );
    const base = { protocol: PROTOCOL_VERSION, action: descriptor.action, version: descriptor.version } as const;
    try {
      const outcome = await handler.perform(input.value, ac);
      if ("error" in outcome) {
        if (!descriptor.errors.includes(outcome.error.code)) {
          throw new UndeclaredErrorCode(`returned undeclared error code ${outcome.error.code}`);
        }
        return { status: 200, body: { ...base, status: "error", error: outcome.error } };
      }
      const effects = outcome.effects;
      const hasEffects = Boolean(effects?.invalidate?.length || effects?.navigate);
      return {
        status: 200,
        body: { ...base, status: "ok", result: outcome.result ?? {}, ...(hasEffects && { effects: compactEffects(effects!) }) },
      };
    } catch (err) {
      if (err instanceof NotFoundError) return fail(404, "not_found");
      if (err instanceof UnauthenticatedError) return fail(401, "unauthenticated");
      if (err instanceof ForbiddenError) return fail(403, "forbidden");
      options.onActionError?.(descriptor.action, descriptor.version, err);
      return fail(500, "action_failed");
    } finally {
      request.abort();
    }
  };
}

function compactEffects(effects: ActionEffects): ActionEffects {
  return {
    ...(effects.invalidate?.length && { invalidate: effects.invalidate }),
    ...(effects.navigate && { navigate: effects.navigate }),
  };
}

/** Parse, validate and perform an HTTP action request body (spec §8.1 error codes). */
export async function performHttp<Ctx>(
  perform: ReturnType<typeof createActions<Ctx>>,
  pathAction: string,
  rawBody: string,
  ctx: Ctx,
): Promise<PerformResult> {
  let req: ActionRequest;
  try {
    req = JSON.parse(rawBody);
  } catch {
    return fail(400, "bad_request", "Body is not valid JSON");
  }
  if (!isActionRequestShape(req)) return fail(400, "bad_request", "Body is not an action request");
  if (req.protocol !== PROTOCOL_VERSION) {
    return fail(400, "unsupported_protocol", `Composer speaks protocol ${PROTOCOL_VERSION}`);
  }
  if (req.action !== pathAction) return fail(400, "action_mismatch", `${req.action} != ${pathAction}`);
  return perform(req, ctx);
}

function isActionRequestShape(v: unknown): v is ActionRequest {
  const r = v as ActionRequest;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.protocol === "number" &&
    typeof r.action === "string" &&
    r.action !== "" &&
    Number.isInteger(r.version) &&
    r.version > 0 &&
    r.input !== undefined &&
    r.input !== null &&
    typeof r.client === "object" &&
    r.client !== null
  );
}
