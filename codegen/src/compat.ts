// Flags manifest changes that break apps already in the wild without an island version bump.
//
// Apps and the composer deploy independently, and old app versions stay installed for a long time.
// So within one island version, every change must keep both directions working:
//   - old apps must decode payloads from the new composer, and
//   - new apps must decode payloads from the old composer (apps can ship first).
// Anything else belongs in a new version of the island (spec §2).

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";

import {
  type Action,
  type Island,
  ManifestError,
  type ObjectDef,
  parseActionManifest,
  parseManifest,
  type TypeRef,
} from "./manifest.ts";

export interface CompatIssue {
  severity: "breaking" | "warning";
  /** What changed, e.g. "profile-header v2", or "action follow-user v1" for actions. */
  island: string;
  /** JSON path within the props, e.g. "props.author.role" */
  path: string;
  message: string;
}

export function compareIslands(base: Island[], head: Island[]): CompatIssue[] {
  const id = (i: Island) => `${i.type}@${i.version}`;
  const headById = new Map(head.map((i) => [id(i), i]));
  const issues: CompatIssue[] = [];

  for (const old of base) {
    const label = `${old.type} v${old.version}`;
    const current = headById.get(id(old));
    if (!current) {
      issues.push({
        severity: "warning",
        island: label,
        path: "",
        message: `island version removed: apps that only support ${old.type} v${old.version} will stop receiving it`,
      });
      continue;
    }
    const report = (path: string, message: string) =>
      issues.push({
        severity: "breaking",
        island: label,
        path,
        message,
      });
    compareObject(old.props, current.props, "props", report);
  }
  return issues;
}

/**
 * Actions follow the same rules (spec §5.1): released apps send old inputs and decode results and
 * error details, so input, result and details evolve like island props. Error codes may come and
 * go, since clients must treat unknown codes as generic failures.
 */
export function compareActions(base: Action[], head: Action[]): CompatIssue[] {
  const id = (a: Action) => `${a.action}@${a.version}`;
  const headById = new Map(head.map((a) => [id(a), a]));
  const issues: CompatIssue[] = [];

  for (const old of base) {
    const label = `action ${old.action} v${old.version}`;
    const current = headById.get(id(old));
    if (!current) {
      issues.push({
        severity: "warning",
        island: label,
        path: "",
        message: `action version removed: apps that call ${old.action} v${old.version} will get unsupported_action_version`,
      });
      continue;
    }
    const report = (path: string, message: string) =>
      issues.push({
        severity: "breaking",
        island: label,
        path,
        message,
      });
    compareObject(old.input, current.input, "input", report);
    compareObject(old.result, current.result, "result", report);
    const currentErrors = new Map(current.errors.map((e) => [e.code, e]));
    for (const before of old.errors) {
      const after = currentErrors.get(before.code);
      if (!after) {
        continue;
      }
      const path = `errors.${before.code}.details`;
      if (before.details && after.details) {
        compareObject(before.details, after.details, path, report);
      } else if (before.details) {
        report(path, "details removed: old apps expect them");
      } else if (after.details) {
        report(
          path,
          "details added: new apps would expect them from a composer that doesn't send them",
        );
      }
    }
  }
  return issues;
}

type Report = (path: string, message: string) => void;

function compareObject(old: ObjectDef, current: ObjectDef, path: string, report: Report): void {
  const currentFields = new Map(current.fields.map((f) => [f.jsonName, f]));
  for (const before of old.fields) {
    const p = `${path}.${before.jsonName}`;
    const after = currentFields.get(before.jsonName);
    if (!after) {
      // Removing an optional property is fine: old apps already handle it being absent.
      if (before.required) {
        report(p, "required property removed: old apps require it");
      }
      continue;
    }
    if (before.required && !after.required) {
      report(p, "became optional: old apps require it, so they'd reject payloads that omit it");
    } else if (!before.required && after.required) {
      report(p, "became required: new apps would reject payloads from a composer that omits it");
    }
    compareType(before.type, after.type, p, report);
  }
  const oldNames = new Set(old.fields.map((f) => f.jsonName));
  for (const added of current.fields) {
    if (!oldNames.has(added.jsonName) && added.required) {
      report(
        `${path}.${added.jsonName}`,
        "required property added: new apps would reject payloads from a composer that doesn't send it yet (add it as optional, or in a new version)",
      );
    }
  }
}

function compareType(old: TypeRef, current: TypeRef, path: string, report: Report): void {
  if (old.kind === "string" && current.kind === "string") {
    if (old.format !== current.format) {
      report(path, `format changed from ${describe(old)} to ${describe(current)}`);
    }
  } else if (old.kind === "integer" && current.kind === "integer") {
    if (old.int64 !== current.int64) {
      report(path, `integer size changed from ${describe(old)} to ${describe(current)}`);
    }
  } else if (old.kind === "array" && current.kind === "array") {
    compareType(old.items, current.items, `${path}[]`, report);
  } else if (old.kind === "map" && current.kind === "map") {
    compareType(old.values, current.values, `${path}{}`, report);
  } else if (old.kind === "object" && current.kind === "object") {
    compareObject(old.def, current.def, path, report);
  } else if (old.kind === "enum" && current.kind === "enum") {
    compareEnum(old.def.values, current.def.values, path, report);
  } else if (old.kind !== current.kind) {
    report(path, `type changed from ${describe(old)} to ${describe(current)}`);
  }
}

function compareEnum(old: string[], current: string[], path: string, report: Report): void {
  const before = new Set(old);
  const after = new Set(current);
  const added = [...after].filter((v) => !before.has(v));
  const removed = [...before].filter((v) => !after.has(v));
  if (added.length) {
    report(
      path,
      `enum value${added.length > 1 ? "s" : ""} added (${quote(added)}): old apps can't decode them`,
    );
  }
  if (removed.length) {
    report(
      path,
      `enum value${removed.length > 1 ? "s" : ""} removed (${quote(removed)}): new apps can't decode them from a composer that still sends them`,
    );
  }
}

function describe(t: TypeRef): string {
  switch (t.kind) {
    case "string":
      return t.format ? `string (${t.format})` : "string";
    case "integer":
      return t.int64 ? "integer (int64)" : "integer";
    case "array":
      return `array of ${describe(t.items)}`;
    case "map":
      return `map of ${describe(t.values)}`;
    case "enum":
      return "enum";
    default:
      return t.kind;
  }
}

const quote = (values: string[]) => values.map((v) => JSON.stringify(v)).join(", ");

/**
 * Loads the island manifests that were in `manifestsDir` at a git ref, e.g. "origin/main".
 * Returns no islands if the directory didn't exist at that ref.
 */
export function loadManifestsAtRef(
  manifestsDir: string,
  ref: string,
): { islands: Island[]; issues: CompatIssue[] } {
  const { items, issues } = loadAtRef(manifestsDir, ref, parseManifest);
  return { islands: items, issues };
}

/** loadManifestsAtRef for action manifests. */
export function loadActionManifestsAtRef(
  actionsDir: string,
  ref: string,
): { actions: Action[]; issues: CompatIssue[] } {
  const { items, issues } = loadAtRef(actionsDir, ref, parseActionManifest);
  return { actions: items, issues };
}

function loadAtRef<T>(
  manifestsDir: string,
  ref: string,
  parse: (raw: unknown, source: string) => T,
): { items: T[]; issues: CompatIssue[] } {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: manifestsDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  let top: string;
  try {
    top = git(["rev-parse", "--show-toplevel"]).trim();
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new ManifestError(
      `can't read git ref ${JSON.stringify(ref)} for ${manifestsDir} (is it a git repo, and is the ref fetched?)`,
    );
  }
  // git reports the resolved top level, so resolve symlinks (e.g. macOS /var -> /private/var) here too.
  const dir = relative(top, realpathSync(manifestsDir)).split(sep).join("/");
  // Paths below are relative to the repository root, so run git from there.
  const gitAtTop = (args: string[]) => git(["-C", top, ...args]);
  const files = gitAtTop(["ls-tree", "-r", "--name-only", ref, "--", dir === "" ? "." : dir])
    .split("\n")
    .filter((f) => f.endsWith(".json") && dirname(f) === (dir === "" ? "." : dir));

  const items: T[] = [];
  const issues: CompatIssue[] = [];
  for (const file of files) {
    const source = `${ref}:${file}`;
    try {
      items.push(parse(JSON.parse(gitAtTop(["show", source])), source));
    } catch (err) {
      // A base manifest the current codegen can't read can't be compared; say so rather than fail.
      issues.push({
        severity: "warning",
        island: file,
        path: "",
        message: `skipped: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { items, issues };
}
