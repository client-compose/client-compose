import { actionFailure } from "@client-compose/react/testing";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { userEvent } from "storybook/test";

import { english, withComposer } from "../../.storybook/composer";
import { TodoSummaryV1 } from "../contract.generated";
import { TodoSummary } from "./TodoSummary";

const meta = {
  component: TodoSummary,
  args: {
    id: "all",
    left: 2,
    done: 1,
    t: english.t(TodoSummaryV1),
  },
} satisfies Meta<typeof TodoSummary>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SomeLeft: Story = {};

export const OneLeft: Story = {
  args: {
    left: 1,
    done: 0,
  },
};

export const AllDone: Story = {
  args: {
    left: 0,
    done: 3,
  },
};

export const ClearingFails: Story = {
  decorators: [
    withComposer({ actions: { "clear-completed": () => actionFailure(503, "unavailable") } }),
  ],
  play: async (context) => {
    const { canvas, args } = context;
    await userEvent.click(canvas.getByRole("button", { name: args.t.clearCompleted }));
  },
};
