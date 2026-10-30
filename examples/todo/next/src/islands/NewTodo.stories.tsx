import { actionError, actionFailure } from "@client-compose/react/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent } from "storybook/test";

import { english, withComposer } from "../../.storybook/composer";
import { AddTodoV1, NewTodoV1 } from "../contract.generated";
import { NewTodo } from "./NewTodo";

const meta = {
  component: NewTodo,
  args: {
    maxLength: 80,
    t: english.t(NewTodoV1),
  },
} satisfies Meta<typeof NewTodo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

// Checked before it's sent: nothing reaches the composer.
export const NothingWritten: Story = {
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("button", { name: args.t.add }));
  },
};

// The composer has the final say: its declared error, in the island's words.
export const TooLongForTheComposer: Story = {
  decorators: [
    withComposer({
      actions: {
        "add-todo": () =>
          actionError(AddTodoV1, { code: "title_too_long", details: { maxLength: 10 } }),
      },
    }),
  ],
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.type(canvas.getByLabelText(args.t.label), "Water the plants");
    await userEvent.click(canvas.getByRole("button", { name: args.t.add }));
  },
};

export const ComposerUnreachable: Story = {
  decorators: [withComposer({ actions: { "add-todo": () => actionFailure(503, "unavailable") } })],
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.type(canvas.getByLabelText(args.t.label), "Water the plants");
    await userEvent.click(canvas.getByRole("button", { name: args.t.add }));
  },
};
