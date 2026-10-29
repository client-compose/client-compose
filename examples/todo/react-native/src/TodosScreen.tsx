import { ComposedScreen, type ScreenState, useAppStrings } from "@client-compose/react";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppStrings } from "./contract.generated";
import { shared } from "./styles";

/** The islands, under the screen's title, scrolling together. */
function layOut(islands: ReactNode[], screen: ScreenState) {
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {screen.response?.meta?.title}
      </Text>
      {islands}
    </ScrollView>
  );
}

/** The todos screen, as the composer makes it up. */
export function TodosScreen() {
  const strings = useAppStrings(AppStrings);

  function couldNotLoad(_error: unknown, reload: () => void) {
    return (
      <View style={shared.center}>
        <Text>{strings.couldNotLoad}</Text>
        <Pressable accessibilityRole="button" onPress={reload} style={shared.button}>
          <Text style={shared.buttonText}>{strings.retry}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ComposedScreen
      screen="todos"
      loading={<ActivityIndicator accessibilityLabel={strings.loading} style={shared.center} />}
      renderError={couldNotLoad}
    >
      {layOut}
    </ComposedScreen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 16 },
  title: { fontSize: 32, fontWeight: "700" },
});
