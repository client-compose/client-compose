import { AppStringsProvider, ClientComposeProvider } from "@client-compose/react";

import { config } from "./config.ts";
import { CouldNotConnect } from "./CouldNotConnect.tsx";
import { TodosScreen } from "./TodosScreen.tsx";

/** Shown if the app strings can't be fetched: the composer isn't running, or can't be reached. */
function couldNotConnect(retry: () => void) {
  return <CouldNotConnect onRetry={retry} />;
}

export function App() {
  return (
    <ClientComposeProvider config={config}>
      <AppStringsProvider failed={couldNotConnect}>
        <main>
          <TodosScreen />
        </main>
      </AppStringsProvider>
    </ClientComposeProvider>
  );
}
