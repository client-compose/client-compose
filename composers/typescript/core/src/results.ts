import {
  type ActionResponse,
  type IslandResponse,
  PROTOCOL_VERSION,
  type ScreenErrorResponse,
} from "@client-compose/protocol";

import type { ScreenStream } from "./stream.ts";

/** A screen, as it's streamed (spec §4.6), or the error the composer answers with. */
export type ComposeResult =
  | { status: 200; body: ScreenStream }
  | { status: 400 | 401 | 403 | 404 | 500 | 502; body: ScreenErrorResponse };

/** One island resolved by an island request, or the error the composer answers with (spec §4.5). */
export type IslandResult =
  | { status: 200; body: IslandResponse }
  | { status: 400 | 401 | 403 | 404 | 500; body: ScreenErrorResponse };

/** An action's outcome, or the error the composer answers with. */
export type PerformResult =
  | { status: 200; body: ActionResponse }
  | { status: 400 | 401 | 403 | 404 | 500; body: ScreenErrorResponse };

/** A protocol error response. */
export function fail<S extends 400 | 401 | 403 | 404 | 500 | 502>(
  status: S,
  code: string,
  message?: string,
): { status: S; body: ScreenErrorResponse } {
  return { status, body: { protocol: PROTOCOL_VERSION, error: { code, message } } };
}
