// The composer from React Server Components: what a page's server code asks it for, each at most
// once per request, however many components ask (React's `cache`).

import { appStrings, fetchStrings, type ScreenStream } from "@client-compose/client";
import type {
  AppStringsDescriptor,
  ClientContext,
  StringsResponse,
} from "@client-compose/protocol";
import { cache } from "react";

import type { ScreenConfig } from "./config.ts";
import { streamScreen } from "./load.ts";

export interface ServerComposerOptions {
  /**
   * Who's asking, worked out for each request, e.g. with the language from its Accept-Language
   * header or a cookie. Default: the config's `client`.
   */
  client?: () => ClientContext | Promise<ClientContext>;
}

export interface ServerComposer {
  /** Who's asking, for this request. */
  client(): Promise<ClientContext>;
  /**
   * The app strings in the client's language, as the composer sends them: pass them on to the
   * browser as `<AppStringsProvider initial>`.
   */
  appStrings(): Promise<StringsResponse>;
  /** The app strings, typed by their generated descriptor: `(await composer.strings(AppStrings)).name`. */
  strings<S>(descriptor: AppStringsDescriptor<S>): Promise<S>;
  /**
   * A screen's stream, opened once for the same screen and params: share it between the page and
   * its metadata (which only waits for the head), and pass it to `<ComposedScreen stream>`.
   */
  openScreen(screen: string, params?: Record<string, string>): Promise<ScreenStream>;
}

/** The same params, however their keys are ordered: one key for React's cache. */
function paramsKey(params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  search.sort();
  return search.toString();
}

/**
 * The composer for Server Components, each request's answers shared by everything that asks. Make it
 * once, in a module of your own, so every component shares it:
 *
 *     export const composer = serverComposer(config, { client: async () => ({ ...config.client, locale: await requestLocale() }) });
 */
export function serverComposer(
  config: ScreenConfig,
  options: ServerComposerOptions = {},
): ServerComposer {
  const client = cache(async () => (options.client ? options.client() : config.client));
  const strings = cache(async () =>
    fetchStrings(
      config.baseUrl,
      await client(),
      { ...config.requestInit, headers: await config.headers?.() },
      config.fetch,
    ),
  );
  const open = cache(async (screen: string, key: string) => {
    const params: Record<string, string> = {};
    new URLSearchParams(key).forEach((value, name) => {
      params[name] = value;
    });
    return streamScreen({ ...config, client: await client() }, screen, params);
  });
  return {
    client,
    appStrings: strings,
    strings: async (descriptor) => appStrings(descriptor, await strings()),
    openScreen: (screen, params = {}) => open(screen, paramsKey(params)),
  };
}
