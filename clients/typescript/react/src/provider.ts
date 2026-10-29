"use client";

// The provider: the config every hook and component reads, the screens on show (so that actions
// can reload them) and their cached responses.

import {
  type ActionEffects,
  type ScreenRef,
  screenRefMatches,
  type ScreenResponse,
} from "@client-compose/protocol";
import { createContext, createElement, type ReactNode, useContext, useMemo, useState } from "react";

import type { ClientComposeConfig } from "./config.ts";
import { EffectsBatch } from "./effects.ts";

interface CacheEntry {
  screen: string;
  params: Record<string, string>;
  response: ScreenResponse;
  expiresAt: number;
}

/** A screen currently shown with useScreen, so that actions can change or reload it. */
interface MountedScreen {
  screen: string;
  params: Record<string, string>;
  reload: () => void;
  /** Applies an action's changes and updates to what's shown, or reloads it if it can't. */
  apply: (batch: EffectsBatch) => void;
}

/** An island a Server Component rendered, as the browser keeps track of it. */
interface RenderedIsland {
  /** Its screen and the screen's params: an invalidation of it means the server must render again. */
  screen: string;
  params: Record<string, string>;
  /** Applies an action's changes and updates, saying whether it could (false: only the server can). */
  apply: (batch: EffectsBatch) => boolean;
}

/**
 * The provider's screens: cached responses, and the screens on show, which actions that change them
 * reload (spec §5.3).
 */
class ScreenStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly mounted = new Set<MountedScreen>();
  private readonly pages = new Set<(batch: EffectsBatch) => void>();
  private readonly rendered = new Set<RenderedIsland>();

  /** The cached response for a key, while it's fresh. */
  cached(key: string): ScreenResponse | undefined {
    const entry = this.cache.get(key);
    return entry && entry.expiresAt > Date.now() ? entry.response : undefined;
  }

  /** Keep a response for its `cache.maxAge`. */
  remember(key: string, screen: string, params: Record<string, string>, response: ScreenResponse) {
    if (!response.cache || response.cache.maxAge <= 0) {
      return;
    }
    const expiresAt = Date.now() + response.cache.maxAge * 1000;
    this.cache.set(key, {
      screen,
      params,
      response,
      expiresAt,
    });
  }

  /** A screen on show. Returns the function that takes it off. */
  mount(screen: MountedScreen): () => void {
    this.mounted.add(screen);
    return () => void this.mounted.delete(screen);
  }

  /** A paged island's pages, kept by usePages, to apply changes to. Returns what stops it. */
  watchPages(apply: (batch: EffectsBatch) => void): () => void {
    this.pages.add(apply);
    return () => void this.pages.delete(apply);
  }

  /** An island a Server Component rendered, which actions change. Returns what stops it. */
  watchRendered(island: RenderedIsland): () => void {
    this.rendered.add(island);
    return () => void this.rendered.delete(island);
  }

  /**
   * Apply an action's changes and updates (spec §5.3) to every screen there is: cached responses
   * (dropped when they'd need a reload), the screens on show, paged islands' pages, and islands
   * Server Components rendered. Returns whether any of those need the server to render them again.
   */
  change(batch: EffectsBatch): boolean {
    for (const [key, entry] of this.cache) {
      const changed = batch.response(entry.response, entry.params);
      if (changed === undefined) {
        this.cache.delete(key);
      } else {
        entry.response = changed;
      }
    }
    for (const apply of this.pages) {
      apply(batch);
    }
    for (const m of this.mounted) {
      m.apply(batch);
    }

    let server = false;
    for (const island of this.rendered) {
      server = !island.apply(batch) || server;
    }

    return server;
  }

  /**
   * Drop cached responses the refs match, and reload the screens on show that they match. Returns
   * whether they match a screen Server Components rendered, which only the server can render again.
   */
  invalidate(refs: ScreenRef[]): boolean {
    const matches = (screen: string, params: Record<string, string>) =>
      refs.some((ref) => screenRefMatches(ref, screen, params));
    for (const [key, entry] of this.cache) {
      if (matches(entry.screen, entry.params)) {
        this.cache.delete(key);
      }
    }
    for (const m of this.mounted) {
      if (matches(m.screen, m.params)) {
        m.reload();
      }
    }

    return [...this.rendered].some((island) => matches(island.screen, island.params));
  }
}

export interface ContextValue {
  config: ClientComposeConfig;
  screens: ScreenStore;
  applyEffects: (effects: ActionEffects) => void;
}

export const ClientComposeContext = createContext<ContextValue | null>(null);

export function ClientComposeProvider(props: {
  config: ClientComposeConfig;
  children?: ReactNode;
}): ReactNode {
  const [screens] = useState(() => new ScreenStore());
  const value = useMemo((): ContextValue => {
    const config = props.config;
    const applyEffects = (effects: ActionEffects) => {
      const batch = new EffectsBatch(effects, (type, version) =>
        config.registry.entities(type, version),
      );
      const changedOnServer = batch.touchesScreens && screens.change(batch);
      const refs = effects.invalidate ?? [];
      const invalidatedOnServer = refs.length > 0 && screens.invalidate(refs);
      if (refs.length) {
        config.onInvalidate?.(refs);
      }
      if (changedOnServer || invalidatedOnServer) {
        config.onStale?.(effects);
      }
      if (effects.navigate) {
        config.onNavigate?.(effects.navigate);
      }
    };
    return {
      config,
      screens,
      applyEffects,
    };
  }, [props.config, screens]);
  return createElement(ClientComposeContext.Provider, { value }, props.children);
}

export function useClientCompose(): ContextValue {
  const ctx = useContext(ClientComposeContext);
  if (!ctx) {
    throw new Error(
      "Client Compose hooks and components must be used inside <ClientComposeProvider>",
    );
  }
  return ctx;
}

/** A class component's context (typed unknown by React): the provider's value, if there is one. */
export function isContextValue(value: unknown): value is ContextValue {
  return typeof value === "object" && value !== null && "config" in value && "screens" in value;
}
