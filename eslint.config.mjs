// Lint rules for the TypeScript and JavaScript in this repo: the community's recommended sets
// (ESLint, typescript-eslint, React, React Hooks) and sorted imports. Formatting is Prettier's job.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/dist/",
    "**/.next/",
    ".build/",
    "build/",
    "**/*.generated.ts",
    "codegen/test/golden/",
    "examples/profile/react-native/.expo/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // React bindings and the React examples.
    files: ["clients/typescript/react/**/*.{ts,tsx}", "examples/**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    ...react.configs.flat["jsx-runtime"],
    settings: { react: { version: "19" } },
  },
  {
    files: ["clients/typescript/react/**/*.{ts,tsx}", "examples/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ["clients/typescript/react/**/*.{ts,tsx}", "examples/**/*.{ts,tsx}"],
    rules: { "react/prop-types": "off" },
  },
  {
    // Tests stand in for the outside world, which takes the odd cast and require.
    files: ["**/test/**", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.config.{js,cjs,mjs}", "examples/profile/react-native/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettier,
]);
