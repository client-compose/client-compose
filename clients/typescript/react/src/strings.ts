"use client";

// Strings (spec §4.7): the app strings, fetched when the app starts and kept, and the client half
// of islands' strings for Client Components rendered by Server Components.

import { appStrings, buildStrings, fetchStrings } from "@client-compose/client";
import type {
  AppStringsDescriptor,
  PluralRules,
  StringParams,
  Strings,
  StringsResponse,
} from "@client-compose/protocol";
import {
  type ComponentType,
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ClientComposeConfig } from "./config.ts";
import { useClientCompose } from "./provider.ts";

// ---- App strings ----

/** Where the app strings are kept between launches: AsyncStorage, localStorage, a file. */
export interface StringsCache {
  /** The strings kept for the language the client asks for, if any. */
  read(locale: string): StringsResponse | undefined | Promise<StringsResponse | undefined>;
  write(locale: string, response: StringsResponse): void | Promise<void>;
}

export interface AppStringsProviderProps {
  /** Strings already fetched, e.g. on the server: shown at once, without a request. */
  initial?: StringsResponse;
  /**
   * Keeps the strings between launches, so the app starts with the last ones while it fetches
   * them again. Without it, every launch waits for them.
   */
  cache?: StringsCache;
  /** Shown until the first strings arrive. Default: nothing. */
  loading?: ReactNode;
  /**
   * Shown when there are no strings to show and they can't be fetched: the composer can't be
   * reached on the app's first launch. It's the only thing the app says in its own words.
   */
  failed?: (retry: () => void, error: unknown) => ReactNode;
  children?: ReactNode;
}

interface Loaded {
  locale: string;
  response?: StringsResponse;
  error?: unknown;
}

const AppStringsContext = createContext<StringsResponse | null>(null);

async function loadStrings(config: ClientComposeConfig): Promise<StringsResponse> {
  if (config.loadStrings) {
    return config.loadStrings();
  }
  const headers = await config.headers?.();
  return fetchStrings(
    config.baseUrl,
    config.client,
    { ...config.requestInit, headers },
    config.fetch,
  );
}

/**
 * Fetches the app strings in the client's language, and renders its children once it has them.
 * With a `cache`, the app starts with the strings it kept last time, and they're fetched again
 * in the background. Put it inside `<ClientComposeProvider>`.
 */
export function AppStringsProvider(props: AppStringsProviderProps): ReactNode {
  const { config } = useClientCompose();
  const locale = config.client.locale ?? "";
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>(() => ({ locale, response: props.initial }));
  const cache = props.cache;
  const initial = attempt === 0 ? props.initial : undefined;

  useEffect(() => {
    if (initial) {
      setLoaded({ locale, response: initial });
      return undefined;
    }
    let stale = false;
    const show = (change: (prev: Loaded) => Loaded) => !stale && setLoaded(change);
    /** Shows the kept strings, if there are any, then fetches them again and keeps those. */
    async function keptThenFresh() {
      const kept = await Promise.resolve(cache?.read(locale)).catch(() => undefined);
      if (kept) {
        show((prev) =>
          prev.locale === locale && prev.response ? prev : { locale, response: kept },
        );
      }
      try {
        const response = await loadStrings(config);
        show(() => ({ locale, response }));
        await cache?.write(locale, response);
      } catch (error) {
        // Strings already shown stay; without them, the app can't say anything.
        show((prev) => (prev.locale === locale && prev.response ? prev : { locale, error }));
      }
    }
    void keptThenFresh();
    return () => {
      stale = true;
    };
    // `attempt` is a retry: the same request again.
  }, [locale, config, cache, initial, attempt]);

  // A new language shows the last one's strings until its own arrive.
  const response = loaded.response;
  if (!response) {
    if (loaded.error !== undefined && props.failed) {
      return props.failed(() => setAttempt((n) => n + 1), loaded.error);
    }
    return props.loading ?? null;
  }
  return createElement(AppStringsContext.Provider, { value: response }, props.children);
}

/**
 * The app strings, typed by their generated descriptor: `useAppStrings(AppStrings).retry`. Use it
 * inside `<AppStringsProvider>`.
 */
export function useAppStrings<S>(descriptor: AppStringsDescriptor<S>): S {
  const response = useContext(AppStringsContext);
  if (!response) {
    throw new Error("useAppStrings must be used inside <AppStringsProvider>");
  }
  return useMemo(() => appStrings(descriptor, response), [descriptor, response]);
}

/**
 * The language the client asks the composer for (`config.client.locale`), for what the app formats
 * itself, such as dates and numbers: `new Intl.DateTimeFormat(useLocale())`.
 */
export function useLocale(): string | undefined {
  return useClientCompose().config.client.locale;
}

// ---- Islands' strings, built in the browser ----

export interface IslandWithStringsProps {
  component: ComponentType<object>;
  props: object;
  declared: StringParams;
  strings?: Strings;
  plurals?: PluralRules;
}

/**
 * A Client Component island rendered by a Server Component: its `t` is made of functions, which
 * can't be sent to the browser, so it's built here from the strings that can.
 */
export function IslandWithStrings(props: IslandWithStringsProps): ReactNode {
  const { component, declared, strings, plurals } = props;
  const t = useMemo(() => buildStrings(declared, strings, plurals), [declared, strings, plurals]);
  const merged = useMemo(() => ({ ...props.props, t }), [props.props, t]);
  return createElement(component, merged);
}
