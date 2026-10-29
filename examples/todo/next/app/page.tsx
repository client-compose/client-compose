// The todos screen, rendered on the server. Its islands stream in as the composer resolves them.
import { ComposedScreen } from "@client-compose/react/server";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { composer, screenConfig } from "../src/composer";
import { AppStrings } from "../src/contract.generated";

export async function generateMetadata(): Promise<Metadata> {
  const { head } = await composer.openScreen("todos");

  return { title: head.meta?.title };
}

export default async function Page() {
  const strings = await composer.strings(AppStrings);
  const { head } = await composer.openScreen("todos");

  function layOut(islands: ReactNode[]) {
    return (
      <>
        <h1>{head.meta?.title}</h1>
        {islands}
      </>
    );
  }

  return (
    <ComposedScreen
      config={screenConfig}
      screen="todos"
      stream={composer.openScreen("todos")}
      renderError={() => <p className="status">{strings.couldNotLoad}</p>}
    >
      {layOut}
    </ComposedScreen>
  );
}
