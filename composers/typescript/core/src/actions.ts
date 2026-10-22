// Actions (spec §5): typed calls that change something.

import {
  PROTOCOL_VERSION,
  type ActionDescriptor,
  type ActionEffects,
  type ActionRequest,
  type ClientContext,
  type DeclaredError,
} from "@client-compose/protocol";

import { attachScope, ForbiddenError, NotFoundError, RequestScope, UnauthenticatedError, type LoadContext } from "./loading.ts";
import type { Failure, Requirement } from "./plugins.ts";
import { fail, type PerformResult } from "./results.ts";
import { validate } from "./validate.ts";

export interface ActionContext<Ctx> extends LoadContext {
  client: ClientContext;
  /** Your app's context for this request, from the composer's `context` function. */
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

/** One action version and how to perform it. Build one with `action`. */
export interface Action<Ctx, I = any, R = any, E extends DeclaredError = any> {
  descriptor: ActionDescriptor<I, R, E>;
  requires?: Requirement<Ctx>[];
  perform: (input: I, ac: ActionContext<Ctx>) => Promise<ActionOutcome<R, E>> | ActionOutcome<R, E>;
}

export interface ActionOptions<Ctx> {
  /** Must all hold before the input is validated and the action runs (401 or 403 otherwise). */
  requires?: Requirement<Ctx>[];
}

/**
 * Define how to perform one action version, by its generated descriptor:
 *
 *     const followUser = action(FollowUserV1, async ({ userId }, { ctx }) => {
 *       if (await blocks.has(userId, ctx.viewer)) return { error: { code: "blocked" } };
 *       const followers = await follows.add(ctx.viewer, userId);
 *       return { result: { followers }, effects: { invalidate: [{ screen: "profile", params: { userId } }] } };
 *     }, { requires: [signedIn] });
 *
 * Throw NotFoundError, UnauthenticatedError or ForbiddenError for those protocol errors. Anything
 * else thrown is a failure: the client gets 500 `action_failed`, and plugins are told.
 */
export function action<I, R, E extends DeclaredError, Ctx = unknown>(
  descriptor: ActionDescriptor<I, R, E>,
  perform: Action<Ctx, I, R, E>["perform"],
  options: ActionOptions<Ctx> = {},
): Action<Ctx, I, R, E> {
  return { descriptor, perform, requires: options.requires };
}

class UndeclaredErrorCode extends Error {}

/** The response for NotFoundError, UnauthenticatedError and ForbiddenError, if err is one of them. */
export function protocolError(err: unknown) {
  if (err instanceof NotFoundError) return fail(404, "not_found");
  if (err instanceof UnauthenticatedError) return fail(401, "unauthenticated");
  if (err instanceof ForbiddenError) return fail(403, "forbidden");
  return undefined;
}

export async function performAction<Ctx>(
  handler: Action<Ctx>,
  req: ActionRequest,
  ctx: Ctx,
  report: (failure: Failure) => void,
): Promise<PerformResult> {
  const { descriptor } = handler;
  const reportFailure = (error: unknown) => report({ kind: "action", action: descriptor.action, version: descriptor.version, error });
  try {
    for (const requirement of handler.requires ?? []) await requirement(ctx);
  } catch (err) {
    const res = protocolError(err);
    if (res) return res;
    reportFailure(err);
    return fail(500, "action_failed");
  }
  const input = validate(descriptor.input, req.input);
  if (!input.ok) return fail(400, "invalid_input", input.message);

  const request = new AbortController();
  const scope = new RequestScope(request.signal);
  const ac = attachScope(
    { client: req.client, ctx, idempotencyKey: req.idempotencyKey, signal: request.signal, load: scope.load.bind(scope) },
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
    const res = protocolError(err);
    if (res) return res;
    reportFailure(err);
    return fail(500, "action_failed");
  } finally {
    request.abort();
  }
}

function compactEffects(effects: ActionEffects): ActionEffects {
  return {
    ...(effects.invalidate?.length && { invalidate: effects.invalidate }),
    ...(effects.navigate && { navigate: effects.navigate }),
  };
}

export function isActionRequestShape(v: unknown): v is ActionRequest {
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
