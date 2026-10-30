import { actionFailure } from "@client-compose/react/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { english, withComposer } from "../../.storybook/composer";
import { TodoListV1 } from "../contract.generated";
import { TodoList } from "./TodoList";

const meta = {
  component: TodoList,
  args: {
    todos: [
      {
        id: "t1",
        title: "Water the plants",
        done: true,
      },
      {
        id: "t2",
        title: "Call the bank",
        done: false,
      },
      {
        id: "t3",
        title: "Book the dentist",
        done: false,
      },
    ],
    t: english.t(TodoListV1),
  },
} satisfies Meta<typeof TodoList>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Todos: Story = {};

export const Empty: Story = { args: { todos: [] } };

// Tick or delete one: the composer can't be reached, and the island says so.
export const ComposerUnreachable: Story = {
  decorators: [
    withComposer({
      actions: {
        "toggle-todo": () => actionFailure(503, "unavailable"),
        "delete-todo": () => actionFailure(503, "unavailable"),
      },
    }),
  ],
};
