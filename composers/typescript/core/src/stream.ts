// A screen as it's answered (spec §4.6): its head, then each pending island as it's resolved.

import type {
  IslandEntry,
  ScreenHead,
  ScreenResponse,
  ScreenStreamLine,
} from "@client-compose/protocol";

import { isRecord } from "./guards.ts";

/** A screen being answered: its head, ready, and its pending islands as each is resolved. */
export interface ScreenStream {
  /** The screen, with each island resolved or pending. */
  head: ScreenHead;
  /** Each pending island's entry once it's resolved, in the order they're resolved. */
  islands: AsyncIterable<IslandEntry>;
}

export function isScreenStream(value: unknown): value is ScreenStream {
  return isRecord(value) && isRecord(value.head) && isRecord(value.islands);
}

/** Reads the rest of a stream, and returns the screen with every island in place. */
export async function collect(stream: ScreenStream): Promise<ScreenResponse> {
  const islands = [...stream.head.islands];
  for await (const entry of stream.islands) {
    const i = islands.findIndex((e) => e.key === entry.key && e.status === "pending");
    if (i !== -1) {
      islands[i] = entry;
    }
  }
  return {
    ...stream.head,
    islands: islands.filter((e): e is IslandEntry => e.status !== "pending"),
  };
}

/** The stream as JSON lines, each ending in a newline: what's sent as `application/jsonl`. */
export async function* streamLines(stream: ScreenStream): AsyncIterable<string> {
  const line = (l: ScreenStreamLine) => `${JSON.stringify(l)}\n`;
  yield line({ kind: "head", ...stream.head });
  for await (const island of stream.islands) {
    yield line({ kind: "island", island });
  }
  yield line({ kind: "end" });
}

/** The entries of `resolving`, one at a time, in the order they settle. */
export async function* inOrderResolved(
  resolving: Promise<IslandEntry>[],
): AsyncIterable<IslandEntry> {
  const waiting = new Map(resolving.map((p, i) => [i, p.then((entry) => ({ i, entry }))]));
  while (waiting.size > 0) {
    const first = await Promise.race(waiting.values());
    waiting.delete(first.i);
    yield first.entry;
  }
}
