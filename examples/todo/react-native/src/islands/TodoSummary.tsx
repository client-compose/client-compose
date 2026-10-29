import { type IslandProps, isUnexpected, useAction, useAppStrings } from "@client-compose/react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppStrings, ClearCompletedV1, type TodoSummaryV1 } from "../contract.generated";
import { shared } from "../styles";

/** How many are left ("1 item left", in the person's language), and a way to clear the done ones. */
export function TodoSummary(props: IslandProps<typeof TodoSummaryV1>) {
  const { left, done, t } = props;
  const strings = useAppStrings(AppStrings);
  const clearCompleted = useAction(ClearCompletedV1);

  async function clear() {
    await clearCompleted.run({});
  }

  return (
    <View style={styles.summary}>
      <View style={styles.row}>
        <Text style={shared.quiet}>{t.left({ count: left })}</Text>
        {done > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={clear}
            disabled={clearCompleted.pending}
            style={shared.button}
          >
            <Text style={shared.buttonText}>{t.clearCompleted}</Text>
          </Pressable>
        )}
      </View>
      {isUnexpected(clearCompleted.last) && (
        <Text accessibilityRole="alert" style={shared.problem}>
          {strings.somethingWentWrong}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
