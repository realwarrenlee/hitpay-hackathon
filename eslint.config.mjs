import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const moneySyntax = [
  { selector: "CallExpression[callee.name='parseFloat']", message: "Use parseSgd. Float money breaks the cent invariants." },
  { selector: "CallExpression[callee.name='Number']", message: "Use parseSgd or an integer conversion that does not parse money text." },
  { selector: "CallExpression[callee.property.name='toFixed']", message: "Use formatSgd or formatAmount." },
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "spike/**", "artifacts/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", ...moneySyntax],
      "no-restricted-properties": ["error", { object: "process", property: "env", message: "Read configuration from src/server/env.ts." }],
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/server/db", "**/server/db"],
          message: "Only ledger.ts writes. Send a command through ledger.run.",
        }],
      }],
    },
  },
  {
    files: ["src/server/env.ts", "src/server/ledger.ts"],
    rules: {
      "no-restricted-properties": "off",
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        ...moneySyntax,
        { selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']", message: "Pass now into the domain." },
        { selector: "NewExpression[callee.name='Date']", message: "Pass now into the domain." },
        { selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']", message: "The domain is deterministic." },
      ],
    },
  },
];

export default eslintConfig;
