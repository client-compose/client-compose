import {
  type ClientComposeConfig,
  ClientComposeProvider,
  Island,
  useScreen,
} from "@client-compose/react";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { registry } from "./islands";

// The Go composer from ../composer-go (go run .). The Android emulator reaches the host via 10.0.2.2.
const COMPOSER_URL = Platform.select({
  android: "http://10.0.2.2:8080",
  default: "http://localhost:8080",
});
const USERS = ["u_1", "u_2", "u_3"];

export default function App() {
  // The signed-in user, sent as X-User-Id (stand-in for real auth).
  const viewer = "u_1";
  const config = useMemo<ClientComposeConfig>(
    () => ({
      registry,
      baseUrl: COMPOSER_URL,
      client: { platform: Platform.OS, appVersion: "1.0.0" },
      headers: () => ({ "X-User-Id": viewer }),
      onSkipped: (entry, reason) => console.warn(`skipped island ${entry.key}: ${reason}`),
      onRenderError: (key, error) => console.error(`island ${key} crashed`, error),
    }),
    [],
  );

  const [profile, setProfile] = useState("u_2");
  return (
    <ClientComposeProvider config={config}>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <View style={styles.tabs}>
          {USERS.map((u) => (
            <Pressable
              key={u}
              onPress={() => setProfile(u)}
              style={[styles.tab, u === profile && styles.tabActive]}
            >
              <Text>{u === viewer ? `${u} (me)` : u}</Text>
            </Pressable>
          ))}
        </View>
        <ProfileScreen userId={profile} />
      </SafeAreaView>
    </ClientComposeProvider>
  );
}

/** Uses the hook directly so the islands can live in a FlatList with pull-to-refresh. */
function ProfileScreen({ userId }: { userId: string }) {
  const screen = useScreen("profile", { userId });

  if (screen.status === "loading") return <ActivityIndicator style={styles.center} />;
  if (screen.status === "error") {
    return (
      <View style={styles.center}>
        <Text>Couldn't load this profile. Is the Go composer running?</Text>
        <Pressable onPress={screen.reload}>
          <Text style={styles.retry}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      data={screen.islands}
      keyExtractor={(island) => island.key}
      renderItem={({ item }) => <Island island={item} />}
      refreshing={screen.refreshing}
      onRefresh={screen.reload}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fafafa" },
  tabs: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  tab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: "#eee" },
  tabActive: { backgroundColor: "#cfdcff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  retry: { color: "#2952cc", fontWeight: "600" },
});
