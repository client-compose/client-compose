// Storybook for the islands: each one alone, in each of its states, as the app renders it (see
// preview.tsx). `pnpm storybook` runs it; `pnpm build-storybook` builds it, as CI does.
import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: ["../src/**/*.stories.tsx"],
  core: { disableTelemetry: true },
};

export default config;
