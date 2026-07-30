import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next 15 ships legacy (eslintrc) configs with no exports map, so
// flat config has to load it through the compatibility shim. This is expected
// on the 15.x line — 16 ships native flat config, and this file simplifies when
// we upgrade.
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      "lib/generated/**",
      "prisma/migrations/**",
    ],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      // Unused code is a review signal, not a build failure — but an underscore
      // prefix is an explicit "I know, this is intentional".
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // `any` erases the reason we chose TypeScript. Warn rather than error so
      // it can be used deliberately at a provider boundary while still showing
      // up in review.
      "@typescript-eslint/no-explicit-any": "warn",

      // Server components render on the server, so a stray console.log goes to
      // production logs rather than a browser devtools panel.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  {
    // Vendor SDKs are the one place loose typing is unavoidable, and scripts
    // legitimately write to stdout.
    files: ["services/**/*.ts", "scripts/**/*.ts", "prisma/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // Must stay last: turns off every stylistic rule that would fight Prettier.
  ...compat.extends("prettier"),
];

export default eslintConfig;
