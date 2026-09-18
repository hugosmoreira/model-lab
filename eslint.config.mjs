/**
 * ESLint flat config for the whole workspace.
 *
 * Two disjoint scopes so the Next.js preset and typescript-eslint never claim
 * the same file (they register the same plugin name):
 *   - apps/web           → eslint-config-next (core-web-vitals + typescript)
 *   - packages, runners  → @eslint/js + typescript-eslint recommended
 *
 * Run: pnpm lint (root) · pnpm -r lint (per package, same config)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import globals from "globals";
import tseslint from "typescript-eslint";

const root = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: root });

const WEB = ["apps/web/**/*.{js,jsx,mjs,cjs,ts,tsx}"];
const LIB_TS = ["packages/**/*.ts", "runners/**/*.ts"];
const LIB_JS = ["packages/**/*.{js,mjs,cjs}", "runners/**/*.{js,mjs,cjs}", "*.{js,mjs,cjs}"];

const unusedVars = [
  "error",
  { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/out/**",
      "artifacts-data/**",
      "docs/example-run/**",
      "runners/build-arena/test/fixtures/**",
      "apps/web/next-env.d.ts",
      ".claude/**",
    ],
  },

  // apps/web — the Next.js preset, scoped to the app and told where it lives.
  ...compat.extends("next/core-web-vitals", "next/typescript").map((config) => ({
    ...config,
    files: WEB,
  })),
  {
    files: WEB,
    settings: { next: { rootDir: "apps/web/" } },
    rules: {
      "@typescript-eslint/no-unused-vars": unusedVars,
    },
  },

  // packages + runners — plain TypeScript, Node (the runner also drives a
  // browser page through page.evaluate callbacks, hence the browser globals).
  {
    files: LIB_TS,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": unusedVars,
    },
  },
  {
    files: LIB_JS,
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-unused-vars": unusedVars,
    },
  },
);
