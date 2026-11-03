// The walk every target shares: what's declared, in what order, and what each declaration means
// (an entity's change type, an action's error without details). A target only renders: it turns
// each declaration into its language's syntax, and never decides what's generated.

import {
  type Action,
  type ActionErrorDef,
  type AppStrings,
  type Entity,
  type EntityPath,
  type EnumDef,
  type Island,
  islandEntityPaths,
  type ObjectDef,
  type ScreenStringsDef,
  type SharedType,
} from "./manifest.ts";

/** Everything one config generates, for one target. */
export interface Model {
  islands: Island[];
  actions: Action[];
  entities: Entity[];
  types: SharedType[];
  screens: ScreenStringsDef[];
  app?: AppStrings;
  /** The code-generated-by comment, one line per entry. */
  header: string;
}

/** What an object type is for, so a target can render what goes with it. */
export type Role =
  /** Nested in another type: named after its property, or its title. */
  | { kind: "nested" }
  /** A shared type (spec §2.2): generated once, used by every reference. */
  | { kind: "shared"; type: SharedType }
  /** An entity's change type (spec §2.1): every property but the id, each optional. */
  | { kind: "entity"; entity: Entity }
  /** An island's props, with where they hold entities. */
  | { kind: "island"; island: Island; entityPaths: EntityPath[] }
  | { kind: "input"; action: Action }
  | { kind: "result"; action: Action }
  /** A declared error: its details, or an empty object when it has none. */
  | { kind: "error"; action: Action; error: ActionErrorDef };

/** A language's syntax for each declaration. Each returns the lines to add. */
export interface Target {
  /** What comes first: the header comment, the package or module, imports. */
  prelude(model: Model): string[];
  /** The app strings (spec §4.7). A target without them leaves this out. */
  appStrings?(app: AppStrings): string[];
  /** A screen's own strings (spec §4.7). */
  screenStrings(screen: ScreenStringsDef): string[];
  enumeration(def: EnumDef): string[];
  /** An object type, and what goes with it before its nested types (an island's descriptor). */
  object(def: ObjectDef, role: Role): string[];
  /** What goes with an object after its nested types (an entity's name, an error's methods). */
  afterChildren?(def: ObjectDef, role: Role): string[];
  /** What comes after an action's types: its descriptor, its errors' union. */
  afterAction?(action: Action): string[];
  /** The whole file, finished (formatted). */
  finish?(source: string): string;
}

/** The empty details of an error that declares none, so every error is a type. */
function errorDetails(error: ActionErrorDef): ObjectDef {
  return (
    error.details ?? {
      kind: "object",
      path: error.path,
      fields: [],
      children: [],
      schemas: {},
    }
  );
}

/** What an action sets on an entity: every property but the id, which names it, each optional. */
function entityChange(entity: Entity): ObjectDef {
  return {
    ...entity.def,
    fields: entity.def.fields
      .filter((f) => f.jsonName !== entity.id)
      .map((f) => ({ ...f, required: false })),
    description: entity.description,
  };
}

export function emit(model: Model, target: Target): string {
  const out: string[] = target.prelude(model);

  const declare = (def: ObjectDef, role: Role) => {
    out.push(...target.object(def, role));
    for (const child of def.children) {
      if (child.kind === "enum") {
        out.push(...target.enumeration(child));
      } else {
        declare(child, { kind: "nested" });
      }
    }
    out.push(...(target.afterChildren?.(def, role) ?? []));
  };

  if (model.app && target.appStrings) {
    out.push(...target.appStrings(model.app));
  }
  for (const screen of model.screens) {
    out.push(...target.screenStrings(screen));
  }
  // Shared types first: every reference to one, in what follows, uses it.
  for (const type of model.types) {
    if (type.def.kind === "enum") {
      out.push(...target.enumeration(type.def));
    } else {
      declare(type.def, { kind: "shared", type });
    }
  }
  for (const entity of model.entities) {
    declare(entityChange(entity), { kind: "entity", entity });
  }
  for (const island of model.islands) {
    declare(island.props, {
      kind: "island",
      island,
      entityPaths: islandEntityPaths(island, model.entities),
    });
  }
  for (const action of model.actions) {
    declare(action.input, { kind: "input", action });
    declare(action.result, { kind: "result", action });
    for (const error of action.errors) {
      declare(errorDetails(error), {
        kind: "error",
        action,
        error,
      });
    }
    out.push(...(target.afterAction?.(action) ?? []));
  }
  const source = `${out.join("\n")}\n`;

  return target.finish ? target.finish(source) : source;
}
