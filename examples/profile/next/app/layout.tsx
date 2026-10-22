import "./styles.css";

import type { ReactNode } from "react";

export const metadata = { title: "Client Compose · Profile (Next.js)" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
