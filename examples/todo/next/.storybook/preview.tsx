import "../app/styles.css";

import type { Preview } from "@storybook/nextjs-vite";

import { withComposer } from "./composer";

const preview: Preview = {
  // A composer that answers nothing: stories whose islands act add their own, inside this one.
  decorators: [withComposer()],
};

export default preview;
