// Entity changes (spec §5.3), applied to an island's props the same way by every client, and by
// composer test kits checking an action's effects against a fresh resolve.

import type { EntityChange, EntityPath } from "./index.ts";

export interface AppliedChanges<Props> {
  /** The props with the changes applied: the same object when nothing changed. */
  props: Props;
  /** A deleted entity is held somewhere it can't be removed from: reload the screen. */
  reload: boolean;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One entity, at the end of a path, by the change that names it. */
function changeFor(
  value: unknown,
  path: EntityPath,
  changes: readonly EntityChange[],
): EntityChange | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  return changes.find((c) => c.entity === path.entity && c.id === value[path.id]);
}

/** The object with a change's properties set, those the island shows. */
function setProperties(value: Json, set: Json, path: EntityPath): Json {
  const shown = Object.entries(set).filter(([name]) => path.properties.includes(name));
  if (shown.length === 0) {
    return value;
  }

  return { ...value, ...Object.fromEntries(shown) };
}

/**
 * Applies changes along one path. Returns the new value (the same one when nothing changed),
 * `undefined` for an entity deleted from an array, and sets `reload` when one was deleted anywhere
 * else.
 */
function applyAlong(
  value: unknown,
  path: EntityPath,
  rest: readonly string[],
  changes: readonly EntityChange[],
  out: { reload: boolean },
  inArray: boolean,
): unknown {
  const [step, ...next] = rest;
  if (step === undefined) {
    const change = changeFor(value, path, changes);
    if (!change || !isObject(value)) {
      return value;
    }

    if ("delete" in change) {
      if (!inArray) {
        out.reload = true;
      }

      return inArray ? undefined : value;
    }

    return setProperties(value, change.set, path);
  }

  if (step === "[]") {
    if (!Array.isArray(value)) {
      return value;
    }

    const items = value.map((item) =>
      applyAlong(item, path, next, changes, out, next.length === 0),
    );
    const kept = items.filter((item) => item !== undefined);
    const same = kept.length === value.length && kept.every((item, i) => item === value[i]);

    return same ? value : kept;
  }

  if (!isObject(value) || !(step === "{}" || step in value)) {
    return value;
  }

  const keys = step === "{}" ? Object.keys(value) : [step];
  let copy: Json | undefined;
  for (const key of keys) {
    const changed = applyAlong(value[key], path, next, changes, out, false);
    if (changed !== value[key]) {
      copy ??= { ...value };
      copy[key] = changed;
    }
  }

  return copy ?? value;
}

/**
 * Applies an action's entity changes to an island's props (spec §5.3), at the paths its
 * descriptor says hold entities. Properties the island doesn't show are ignored; a deleted entity
 * is removed from the array holding it, and anywhere else asks for its screen to be reloaded.
 */
export function applyChanges<Props>(
  props: Props,
  paths: readonly EntityPath[],
  changes: readonly EntityChange[],
): AppliedChanges<Props> {
  const out = { reload: false };
  let current: unknown = props;
  for (const path of paths) {
    current = applyAlong(current, path, path.path, changes, out, false);
  }

  // Each step returns its input unless it changed, and changes keep the props' shape.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return { props: current as Props, reload: out.reload };
}

/** An entity an island's props hold: which one, by its id. */
export interface HeldEntity {
  entity: string;
  id: string;
}

/** Collects the entities along one path. */
function collectAlong(
  value: unknown,
  path: EntityPath,
  rest: readonly string[],
  out: HeldEntity[],
): void {
  const [step, ...next] = rest;
  if (step === undefined) {
    const id = isObject(value) ? value[path.id] : undefined;
    if (typeof id === "string") {
      out.push({ entity: path.entity, id });
    }

    return;
  }

  if (step === "[]") {
    for (const item of Array.isArray(value) ? value : []) {
      collectAlong(item, path, next, out);
    }

    return;
  }

  if (!isObject(value)) {
    return;
  }

  const keys = step === "{}" ? Object.keys(value) : [step];
  for (const key of keys) {
    collectAlong(value[key], path, next, out);
  }
}

/**
 * The entities an island's props hold, at the paths its descriptor says hold them: what an action's
 * changes (spec §5.3) could change in it.
 */
export function heldEntities(props: unknown, paths: readonly EntityPath[]): HeldEntity[] {
  const out: HeldEntity[] = [];
  for (const path of paths) {
    collectAlong(props, path, path.path, out);
  }

  return out;
}
