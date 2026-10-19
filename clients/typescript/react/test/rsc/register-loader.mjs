// Turns "use client" modules into client references, as a bundler does for React Server Components.
import { register } from "node:module";

// Hooks registered later run first: React's loader runs, and its source comes through ours.
register("./source-as-string.mjs", import.meta.url);
register("react-server-dom-webpack/node-loader", import.meta.url);
