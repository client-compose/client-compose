"use client";
// Client Compose in the browser, for the islands' actions. The page is rendered on the server, and
// its islands, Client Components, take an action's changes and updates in the browser. What only
// the server can show (an invalidated screen, or a change an island can't take) it renders again
// (router.refresh).
import {
  AppStringsProvider,
  type ClientComposeConfig,
  ClientComposeProvider,
  type StringsResponse,
} from "@client-compose/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo } from "react";

import { registry } from "./registry";

export interface ClientComposeProps {
  locale: string;
  /** The app strings, fetched with the page on the server. */
  strings: StringsResponse;
  children: ReactNode;
}

export function ClientCompose(props: ClientComposeProps) {
  const { locale, strings, children } = props;
  const router = useRouter();

  const config = useMemo(
    (): ClientComposeConfig => ({
      // The islands' entities, for their changes, and what actions ask the composer to update.
      registry,
      baseUrl: "",
      client: {
        platform: "web",
        appVersion: "1.0.0",
        locale,
      },
      onStale: () => router.refresh(),
    }),
    [locale, router],
  );

  return (
    <ClientComposeProvider config={config}>
      <AppStringsProvider initial={strings}>{children}</AppStringsProvider>
    </ClientComposeProvider>
  );
}
