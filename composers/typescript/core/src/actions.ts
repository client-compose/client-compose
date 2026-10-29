// Actions (spec §5): typed calls that change something.

import {
  type ActionDescriptor,
  type ActionEffects,
  type ActionRequest,
  type ClientContext,
  type DeclaredError,
  type EntityChange,
  type EntityDescriptor,
  type IslandUpdate,
  PROTOCOL_VERSION,
  type ScreenRef,
  type ScreenStringsDescriptor,
} from "@client-compose/protocol";

import { isRecord } from "./guards.ts";
import {
  attachScope,
  ForbiddenError,
  type LoadContext,
  NotFoundError,
  RequestScope,
  UnauthenticatedError,
} from "./loading.ts";
import type { Failure, Requirement } from "./plugins.ts";
import { fail, type PerformResult } from "./results.ts";
import { type LocaleStrings, screenStrings } from "./strings.ts";
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
  /**
   * Screen strings (spec §4.7) in the client's language, typed by their generated descriptor, for
   * words an action's result carries: `ac.strings(SearchScreenStrings).creators`.
   */
  strings: <S>(descriptor: ScreenStringsDescriptor<S>) => S;
}

/** An island on the screen with exactly these params (spec §5.3), whose content an action changed. */
export interface IslandRef {
  screen: string;
  params?: Record<string, string>;
  key: string;
}

/**
 * What an action changed (spec §5.3), as narrowly as it can say: entities' properties, then
 * islands' content, then whole screens.
 */
export interface Effects {
  /**
   * Entities the action changed: clients apply them to every island holding them, and nothing is
   * resolved again. Build them with `changed` and `deleted`.
   */
  changes?: EntityChange[];
  /**
   * Islands whose content changed beyond their entities, such as a new item in a list. The
   * composer resolves each again and sends its entry, or invalidates its screen if the island isn't
   * on it any more, or fails.
   */
  update?: IslandRef[];
  /** Screens whose layout may have changed. Clients reload the ones on show. */
  invalidate?: ScreenRef[];
  /** A screen to show next. Clients map it to their own routes, and may ignore it. */
  navigate?: ScreenRef;
}

/** An entity's properties an action changed: `changed(TodoEntity, "3", { done: true })`. */
export function changed<Properties extends object>(
  entity: EntityDescriptor<Properties>,
  id: string,
  set: Properties,
): EntityChange {
  return {
    entity: entity.entity,
    id,
    set: Object.fromEntries(Object.entries(set)),
  };
}

/** An entity an action deleted: clients remove it from the lists that hold it. */
export function deleted<Properties>(
  entity: EntityDescriptor<Properties>,
  id: string,
): EntityChange {
  return {
    entity: entity.entity,
    id,
    delete: true,
  };
}

/** The islands an action named in `update`, resolved (spec §5.3), and the screens to reload instead. */
export interface ResolvedUpdates {
  update: IslandUpdate[];
  invalidate: ScreenRef[];
}

/** What an action returns: a result (and optionally its effects), or one of its declared errors. */
export type ActionOutcome<R, E extends DeclaredError> =
  { result: R; effects?: Effects } | { error: E };

/** One action version and how to perform it. Build one with `action`. */
export interface Action<Ctx, I = unknown, R = unknown, E extends DeclaredError = DeclaredError> {
  descriptor: ActionDescriptor<I, R, E>;
  requires?: Requirement<Ctx>[];
  // A method, not a function property, so actions with different inputs share one list
  // (`Action<Ctx>[]`): method parameters are checked bivariantly.
  perform(input: I, ac: ActionContext<Ctx>): Promise<ActionOutcome<R, E>> | ActionOutcome<R, E>;
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
  return {
    descriptor,
    perform,
    requires: options.requires,
  };
}

class UndeclaredErrorCode extends Error {}

/** The response for NotFoundError, UnauthenticatedError and ForbiddenError, if err is one of them. */
export function protocolError(err: unknown) {
  if (err instanceof NotFoundError) {
    return fail(404, "not_found");
  }
  if (err instanceof UnauthenticatedError) {
    return fail(401, "unauthenticated");
  }
  if (err instanceof ForbiddenError) {
    return fail(403, "forbidden");
  }
  return undefined;
}

export async function performAction<Ctx>(
  handler: Action<Ctx>,
  req: ActionRequest,
  ctx: Ctx,
  report: (failure: Failure) => void,
  words: LocaleStrings | undefined,
  resolveUpdates: (refs: IslandRef[]) => Promise<ResolvedUpdates>,
): Promise<PerformResult> {
  const { descriptor } = handler;
  const reportFailure = (error: unknown) =>
    report({
      kind: "action",
      action: descriptor.action,
      version: descriptor.version,
      error,
    });
  try {
    for (const requirement of handler.requires ?? []) {
      await requirement(ctx, { params: {}, client: req.client });
    }
  } catch (err) {
    const res = protocolError(err);
    if (res) {
      return res;
    }
    reportFailure(err);
    return fail(500, "action_failed");
  }
  const input = validate(descriptor.input, req.input);
  if (!input.ok) {
    return fail(400, "invalid_input", input.message);
  }

  const request = new AbortController();
  const scope = new RequestScope(request.signal);
  const ac = attachScope(
    {
      client: req.client,
      ctx,
      idempotencyKey: req.idempotencyKey,
      signal: request.signal,
      load: scope.load.bind(scope),
      strings: <S>(d: ScreenStringsDescriptor<S>) => screenStrings(words, d),
    },
    scope,
  );
  const base = {
    protocol: PROTOCOL_VERSION,
    action: descriptor.action,
    version: descriptor.version,
  } as const;
  try {
    const outcome = await handler.perform(input.value, ac);
    if ("error" in outcome) {
      if (!descriptor.errors.includes(outcome.error.code)) {
        throw new UndeclaredErrorCode(`returned undeclared error code ${outcome.error.code}`);
      }
      return {
        status: 200,
        body: {
          ...base,
          status: "error",
          error: outcome.error,
        },
      };
    }
    const effects = await sentEffects(outcome.effects ?? {}, resolveUpdates);
    const hasEffects = Object.keys(effects).length > 0;

    return {
      status: 200,
      body: {
        ...base,
        status: "ok",
        // Results are objects: the manifest's result schema says so (spec §5.1).
        result: isRecord(outcome.result) ? outcome.result : {},
        ...(hasEffects && { effects }),
      },
    };
  } catch (err) {
    const res = protocolError(err);
    if (res) {
      return res;
    }
    reportFailure(err);
    return fail(500, "action_failed");
  } finally {
    request.abort();
  }
}

/** The effects clients get: updates resolved, and nothing empty. */
async function sentEffects(
  effects: Effects,
  resolveUpdates: (refs: IslandRef[]) => Promise<ResolvedUpdates>,
): Promise<ActionEffects> {
  const resolved = effects.update?.length
    ? await resolveUpdates(effects.update)
    : { update: [], invalidate: [] };
  const invalidate = [...(effects.invalidate ?? []), ...resolved.invalidate];

  return {
    ...(effects.changes?.length && { changes: effects.changes }),
    ...(resolved.update.length && { update: resolved.update }),
    ...(invalidate.length && { invalidate }),
    ...(effects.navigate && { navigate: effects.navigate }),
  };
}

export function isActionRequestShape(v: unknown): v is ActionRequest {
  if (!isRecord(v)) {
    return false;
  }
  const named = typeof v.protocol === "number" && typeof v.action === "string" && v.action !== "";
  const versioned = typeof v.version === "number" && Number.isInteger(v.version) && v.version > 0;
  const hasInput = v.input !== undefined && v.input !== null;
  return named && versioned && hasInput && isRecord(v.client) && isRecord(v.islands);
}
