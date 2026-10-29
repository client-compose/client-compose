import { AppStringsProvider, ClientComposeProvider } from "@client-compose/react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet } from "react-native";

import { config } from "./config";
import { CouldNotConnect } from "./CouldNotConnect";
import { TodosScreen } from "./TodosScreen";

/** Shown if the app strings can't be fetched: the composer isn't running, or can't be reached. */
function couldNotConnect(retry: () => void) {
  return <CouldNotConnect onRetry={retry} />;
}

export default function App() {
  return (
    <ClientComposeProvider config={config}>
      <SafeAreaView style={styles.root}>
        <StatusBar style="auto" />
        <AppStringsProvider failed={couldNotConnect}>
          <TodosScreen />
        </AppStringsProvider>
      </SafeAreaView>
    </ClientComposeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
