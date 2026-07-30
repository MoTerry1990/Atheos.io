/**
 * Formatting is not a matter of opinion in this repo — it is enforced on commit
 * so that no diff ever contains a whitespace change mixed with a logic change.
 *
 * @type {import("prettier").Config}
 */
const config = {
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  arrowParens: "always",
  endOfLine: "lf",

  plugins: [
    // Sorts Tailwind classes into the canonical order. With utility-first CSS
    // the class attribute is the stylesheet, and an unsorted one is unreadable
    // in review.
    "prettier-plugin-tailwindcss",
  ],

  // Tailwind v4 has no JS config file; the plugin needs to be pointed at the
  // stylesheet that holds the @theme block instead.
  tailwindStylesheet: "./styles/globals.css",
  tailwindFunctions: ["cn", "cva", "clsx", "twMerge"],
};

export default config;
