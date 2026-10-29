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

/**
 * The provider's screens: cached responses, and the screens on show, which actions that change them
 * reload (spec §5.3).
 */
class ScreenStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly mounted = new Set<MountedScreen>();
  private readonly pages = new Set<(batch: EffectsBatch) => void>();

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

  /**
   * Apply an action's changes and updates (spec §5.3) to every screen there is: cached responses
   * (dropped when they'd need a reload), the screens on show, and paged islands' pages.
   */
  change(batch: EffectsBatch) {
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
  }

  /** Drop cached responses the refs match, and reload the screens on show that they match. */
  invalidate(refs: ScreenRef[]) {
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
      if (batch.touchesScreens) {
        screens.change(batch);
      }
      const refs = effects.invalidate ?? [];
      if (refs.length) {
        screens.invalidate(refs);
        config.onInvalidate?.(refs);
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
