// An action's changes and updates (spec §5.3), applied to the screens a client has: their islands'
// props, and the pages a paged island holds.

import { applyChanges } from "@client-compose/client";
import type {
  ActionEffects,
  EntityPath,
  IslandEntry,
  PendingIsland,
  ScreenHead,
  ScreenResponse,
} from "@client-compose/protocol";

/** Where an island version's props hold entities: the registry knows, from its descriptors. */
export type EntitiesOf = (type: string, version: number) => readonly EntityPath[];

/**
 * One action's effects, applied the same way to every screen and every page: each props object is
 * changed once, so a screen and its paged islands agree on the result.
 */
export class EffectsBatch {
  private readonly changedProps = new WeakMap<object, { props: unknown; reload: boolean }>();
  readonly effects: ActionEffects;
  private readonly entities: EntitiesOf;

  constructor(effects: ActionEffects, entities: EntitiesOf) {
    this.effects = effects;
    this.entities = entities;
  }

  /** Whether there's anything here for screens: changes or updates. */
  get touchesScreens(): boolean {
    return Boolean(this.effects.changes?.length || this.effects.update?.length);
  }

  /** An island's props with the changes applied; `reload` when one can't be shown without it. */
  props<P>(props: P, type: string, version: number): { props: P; reload: boolean } {
    const changes = this.effects.changes ?? [];
    if (changes.length === 0 || typeof props !== "object" || props === null) {
      return { props, reload: false };
    }

    const known = this.changedProps.get(props);
    if (known) {
      // Applied to this object already in this batch: the same result, the same object.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return known as { props: P; reload: boolean };
    }

    const applied = applyChanges(props, this.entities(type, version), changes);
    this.changedProps.set(props, applied);

    return applied;
  }

  /**
   * A screen with the changes and updates applied, or undefined when the client must reload it: a
   * deleted entity held where it can't be removed, or an update the screen can't take (spec §5.3).
   */
  screen(head: ScreenHead, params: Record<string, string>): ScreenHead | undefined {
    let reload = false;
    const islands = head.islands.map((entry): IslandEntry | PendingIsland => {
      if (entry.status !== "ok") {
        return entry;
      }

      const changed = this.props(entry.props, entry.type, entry.version);
      reload ||= changed.reload;

      return changed.props === entry.props ? entry : { ...entry, props: changed.props };
    });
    if (reload) {
      return undefined;
    }

    for (const update of this.effects.update ?? []) {
      if (update.screen !== head.screen || !sameParams(update.params, params)) {
        continue;
      }

      const i = islands.findIndex((entry) => entry.key === update.island.key);
      const current = islands[i];
      if (!current || current.status === "pending" || current.type !== update.island.type) {
        return undefined;
      }

      islands[i] = update.island;
    }

    return islands.every((entry, i) => entry === head.islands[i]) ? head : { ...head, islands };
  }

  /** A whole screen, such as a cached one, with the changes and updates applied, as `screen`. */
  response(response: ScreenResponse, params: Record<string, string>): ScreenResponse | undefined {
    const changed = this.screen(response, params);
    if (changed === undefined) {
      return undefined;
    }

    return changed === response
      ? response
      : { ...changed, islands: changed.islands.filter(isWhole) };
  }
}

/** Changes and updates leave a whole screen whole: nothing in it is pending. */
function isWhole(entry: IslandEntry | PendingIsland): entry is IslandEntry {
  return entry.status !== "pending";
}

function sameParams(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);

  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
