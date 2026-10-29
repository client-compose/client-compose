import type { IslandProps } from "@client-compose/react";
import { StyleSheet, Text, View } from "react-native";

import type { TodoListV1 } from "../contract.generated";
import { shared } from "../styles";
import { TodoItem } from "./TodoItem";

/** The todos, oldest first, or a word to say there are none. */
export function TodoList(props: IslandProps<typeof TodoListV1>) {
  const { todos, t } = props;

  if (todos.length === 0) {
    return <Text style={shared.quiet}>{t.empty}</Text>;
  }

  return (
    <View style={styles.list}>
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} t={t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 4 },
});
