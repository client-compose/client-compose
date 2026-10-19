import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClientComposeProvider, ComposedScreen, type ClientComposeConfig } from "@client-compose/react";
import { registry } from "./islands.tsx";
import "./styles.css";

const USERS = ["u_1", "u_2", "u_3"];

function App() {
  // The signed-in user, sent as X-User-Id (stand-in for real auth).
  const [viewer, setViewer] = useState("u_1");
  const [profile, setProfile] = useState("u_2");

  const config = useMemo<ClientComposeConfig>(
    () => ({
      registry,
      baseUrl: "", // same origin; Vite proxies /screens to the Go composer
      client: { platform: "web", appVersion: "1.0.0", locale: navigator.language },
      headers: () => ({ "X-User-Id": viewer }),
      onSkipped: (entry, reason) => console.warn(`skipped island ${entry.key}: ${reason}`),
      onRenderError: (key, error) => console.error(`island ${key} crashed`, error),
    }),
    [viewer],
  );

  return (
    <ClientComposeProvider config={config}>
      <nav>
        <label>
          Signed in as{" "}
          <select value={viewer} onChange={(e) => setViewer(e.target.value)}>
            {USERS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label>
          Viewing profile{" "}
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            {USERS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
      </nav>
      <main>
        <ComposedScreen
          screen="profile"
          params={{ userId: profile }}
          loading={<p className="status">Loading…</p>}
          renderError={(_, reload) => (
            <p className="status">
              Couldn't load this profile. Is the Go composer running? <button onClick={reload}>Retry</button>
            </p>
          )}
        />
      </main>
    </ClientComposeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
