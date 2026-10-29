import { Pressable, Text, View } from "react-native";

import { shared } from "./styles";

export interface CouldNotConnectProps {
  onRetry: () => void;
}

/**
 * The one thing the app says in its own words: without the composer, it has no others. A real app
 * might say it in a few languages.
 */
export function CouldNotConnect(props: CouldNotConnectProps) {
  const { onRetry } = props;

  return (
    <View style={shared.center}>
      <Text>Couldn't reach the composer. Is one running?</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={shared.button}>
        <Text style={shared.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}
