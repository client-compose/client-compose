import "./styles.css";

import type { ReactNode } from "react";

import { ClientCompose } from "../src/ClientCompose";
import { composer } from "../src/composer";

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout(props: RootLayoutProps) {
  const { children } = props;
  const client = await composer.client();
  const strings = await composer.appStrings();

  return (
    <html lang={strings.locale}>
      <body>
        <main>
          <ClientCompose locale={client.locale ?? "en"} strings={strings}>
            {children}
          </ClientCompose>
        </main>
      </body>
    </html>
  );
}
