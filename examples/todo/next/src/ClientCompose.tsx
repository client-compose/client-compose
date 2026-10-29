"use client";
// Client Compose in the browser, for the islands' actions. The page is rendered on the server, so
// when an action changes the screen, the server renders it again (router.refresh).
import {
  AppStringsProvider,
  type ClientComposeConfig,
  ClientComposeProvider,
  ReactIslandRegistry,
  type StringsResponse,
} from "@client-compose/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useMemo } from "react";

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
      // The browser renders no screens itself: the server does.
      registry: new ReactIslandRegistry(),
      baseUrl: "",
      client: {
        platform: "web",
        appVersion: "1.0.0",
        locale,
      },
      onInvalidate: () => router.refresh(),
    }),
    [locale, router],
  );

  return (
    <ClientComposeProvider config={config}>
      <AppStringsProvider initial={strings}>{children}</AppStringsProvider>
    </ClientComposeProvider>
  );
}
