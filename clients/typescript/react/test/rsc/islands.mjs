// A registry mixing Server Components and a Client Component, imported from the built package's
// main entry, as an app's shared islands module would be.
import { createElement } from "react";

import { ReactIslandRegistry } from "../../dist/index.js";
import { Counter } from "./counter.mjs";

/** An async Server Component island. */
async function Header({ name }) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return createElement("h1", null, name);
}

/** A Server Component island that throws while rendering. */
function Broken() {
  throw new Error("broken island");
}

export const registry = new ReactIslandRegistry()
  .registerComponent({ type: "header", version: 1 }, Header)
  .registerComponent({ type: "counter", version: 1 }, Counter, {
    placeholder: () => createElement("p", { "aria-busy": true }, "counting…"),
  })
  .registerComponent({ type: "broken", version: 1 }, Broken);
