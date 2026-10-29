import { type IslandProps, useAction, useAppStrings } from "@client-compose/react";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { AddTodoV1, AppStrings, type NewTodoV1 } from "../contract.generated";
import { shared } from "../styles";
import { addTodoProblem, titleProblem } from "./newTodoProblem";

/** A field for a new todo. It's checked before it's sent, and the composer checks it again. */
export function NewTodo(props: IslandProps<typeof NewTodoV1>) {
  const { maxLength, t } = props;
  const strings = useAppStrings(AppStrings);
  const addTodo = useAction(AddTodoV1);
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string>();

  function edit(text: string) {
    setTitle(text);
    setProblem(undefined);
  }

  async function add() {
    const before = titleProblem(t, title, maxLength);

    if (before) {
      setProblem(before);

      return;
    }

    const added = await addTodo.run({ title });

    if (added.status === "ok") {
      setTitle("");

      return;
    }

    setProblem(
      added.status === "error" ? addTodoProblem(t, added.error) : strings.somethingWentWrong,
    );
  }

  return (
    <View style={styles.form}>
      <View style={styles.row}>
        <TextInput
          value={title}
          onChangeText={edit}
          onSubmitEditing={add}
          placeholder={t.placeholder}
          accessibilityLabel={t.label}
          returnKeyType="done"
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          onPress={add}
          disabled={addTodo.pending}
          style={shared.button}
        >
          <Text style={shared.buttonText}>{t.add}</Text>
        </Pressable>
      </View>
      {problem && (
        <Text accessibilityRole="alert" style={shared.problem}>
          {problem}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: "#9ca3af",
    borderRadius: 6,
  },
});
