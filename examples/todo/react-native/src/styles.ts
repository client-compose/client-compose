import { StyleSheet } from "react-native";

/** What the screens and islands share. */
export const shared = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  quiet: { opacity: 0.7 },
  problem: { color: "#c0392b" },
  button: { paddingVertical: 8, paddingHorizontal: 12 },
  buttonText: { color: "#2563eb", fontWeight: "600" },
});
