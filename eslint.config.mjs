// Lint rules for the TypeScript and JavaScript in this repo: the community's recommended sets
// (ESLint, typescript-eslint, React, React Hooks), sorted imports, and a few rules for code that's
// easy to read and review:
//
//   - braces on every if, and no nested ternaries: one condition, one block;
//   - no type assertions (`as`, except `as const`) or non-null assertions outside tests: check
//     values with a type guard where they arrive, so the types are true at runtime;
//   - an object literal of three or more properties has one per line;
//   - template literals rather than joined strings, === rather than ==.
//
// Formatting is Prettier's job.
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
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
    "**/storybook-static/",
    ".build/",
    "build/",
    "**/*.generated.ts",
    "codegen/test/golden/",
    "examples/todo/react-native/.expo/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "no-nested-ternary": "error",
      "prefer-template": "error",
      eqeqeq: ["error", "smart"],
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
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
    rules: { "react/prop-types": "off", "react/no-array-index-key": "error" },
  },
  {
    // Tests stand in for the outside world, which takes the odd cast and require.
    files: ["**/test/**", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Test kits and conformance servers read what the composer or client under test answered
    // (whose shapes its own types already guarantee), and type props by a generated descriptor,
    // whose props type exists only at the type level.
    files: ["**/src/testing.ts", "**/src/conformance.ts"],
    rules: { "@typescript-eslint/consistent-type-assertions": "off" },
  },
  {
    files: ["**/*.config.{js,cjs,mjs}", "examples/todo/react-native/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  prettier,
  // After Prettier's config, which turns these off: they're about reading, not layout, and
  // Prettier keeps what they ask for.
  { rules: { curly: ["error", "all"] } },
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/object-curly-newline": [
        "error",
        {
          ObjectExpression: {
            minProperties: 3,
            multiline: true,
            consistent: true,
          },
          ObjectPattern: { multiline: true, consistent: true },
          ImportDeclaration: { multiline: true, consistent: true },
          ExportDeclaration: { multiline: true, consistent: true },
        },
      ],
    },
  },
]);
