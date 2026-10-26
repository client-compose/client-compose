// Fetching a screen without React: usable on the server (loaders, getServerSideProps, Server
// Components) and in the browser.

import { buildRequest, fetchScreen } from "@client-compose/client";
import type { ScreenResponse } from "@client-compose/protocol";

import type { ScreenConfig } from "./config.ts";

/**
 * Fetch a screen from the composer, declaring the islands `config.registry` can render.
 *
 * For server rendering, call this in your loader and pass the result to `useScreen` or
 * `<ComposedScreen>` as `initialResponse`: the server renders the islands, and the client hydrates
 * without fetching again. The response is plain JSON, so it serialises as-is.
 */
export async function loadScreen(
  config: ScreenConfig,
  screen: string,
  params: Record<string, string> = {},
  init: RequestInit = {},
): Promise<ScreenResponse> {
  const headers = await config.headers?.();
  const request = buildRequest(config.registry, screen, config.client, params);
  return fetchScreen(
    config.baseUrl,
    request,
    {
      ...config.requestInit,
      ...init,
      headers: { ...headers, ...headerRecord(init.headers) },
    },
    config.fetch,
  );
}

/** Headers given any way fetch takes them, as a plain record to merge with others. */
function headerRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, name) => {
    out[name] = value;
  });
  return out;
}
