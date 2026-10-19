"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ClientComposeProvider, ComposedScreen, type ClientComposeConfig, type ScreenResponse } from "@client-compose/react";
import { registry } from "./islands";

const USERS = ["u_1", "u_2", "u_3"];

/**
 * The classic server-rendering pattern: the page fetched the screen on the server (loadScreen) and
 * passes it in as initialResponse. The HTML is complete, hydration doesn't refetch, and later
 * navigations fetch from the browser.
 */
export function ClientProfile(props: { viewer: string; userId: string; initialResponse: ScreenResponse }) {
  const config = useMemo<ClientComposeConfig>(
    () => ({
      registry,
      baseUrl: "", // same origin: next.config.ts rewrites /screens to the composer
      client: { platform: "web", appVersion: "1.0.0" },
      headers: () => ({ "X-User-Id": props.viewer }),
      onRenderError: (key, error) => console.error(`island ${key} crashed`, error),
    }),
    [props.viewer],
  );

  return (
    <ClientComposeProvider config={config}>
      <nav>
        {USERS.map((u) => (
          <Link key={u} href={`/ssr/${u}?as=${props.viewer}`} className={u === props.userId ? "active" : ""}>
            {u}
          </Link>
        ))}
      </nav>
      <ComposedScreen
        screen="profile"
        params={{ userId: props.userId }}
        initialResponse={props.initialResponse}
        loading={<p className="status">Loading…</p>}
        renderError={(_, reload) => (
          <p className="status">
            Couldn&apos;t load this profile. <button onClick={reload}>Retry</button>
          </p>
        )}
      />
    </ClientComposeProvider>
  );
}
