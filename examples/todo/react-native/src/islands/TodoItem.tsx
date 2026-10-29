import { isUnexpected, useAction, useAppStrings } from "@client-compose/react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  AppStrings,
  DeleteTodoV1,
  type TodoListV1Strings,
  type TodoListV1Todo,
  ToggleTodoV1,
} from "../contract.generated";
import { shared } from "../styles";

export interface TodoItemProps {
  todo: TodoListV1Todo;
  t: TodoListV1Strings;
}

/** One todo: a switch that marks it done, and a button that deletes it. */
export function TodoItem(props: TodoItemProps) {
  const { todo, t } = props;
  const strings = useAppStrings(AppStrings);
  const toggleTodo = useAction(ToggleTodoV1);
  const deleteTodo = useAction(DeleteTodoV1);
  const failed = isUnexpected(toggleTodo.last) || isUnexpected(deleteTodo.last);

  async function toggle(done: boolean) {
    await toggleTodo.run({ id: todo.id, done });
  }

  async function remove() {
    await deleteTodo.run({ id: todo.id });
  }

  return (
    <View style={styles.item}>
      <View style={styles.row}>
        <Switch
          value={todo.done}
          onValueChange={toggle}
          disabled={toggleTodo.pending}
          accessibilityLabel={t.markDone({ title: todo.title })}
        />
        <Text style={[styles.title, todo.done && styles.done]}>{todo.title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.deleteLabel({ title: todo.title })}
          onPress={remove}
          disabled={deleteTodo.pending}
          style={shared.button}
        >
          <Text style={shared.buttonText}>{t.delete}</Text>
        </Pressable>
      </View>
      {failed && (
        <Text accessibilityRole="alert" style={shared.problem}>
          {strings.somethingWentWrong}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: 6, gap: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: { flex: 1, fontSize: 16 },
  done: { textDecorationLine: "line-through", opacity: 0.6 },
});
