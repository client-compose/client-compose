import type { ReactNode } from "react";
import "./styles.css";

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
