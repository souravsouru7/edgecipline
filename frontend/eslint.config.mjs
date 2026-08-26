import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Capacitor copies the built export into the native projects. Linting
    // those minified chunks produced ~44,000 phantom problems that buried the
    // real ones — every finding came from generated code we do not author.
    "android/app/src/main/assets/public/**",
    "ios/App/App/public/**",
    // Native build output.
    "android/app/build/**",
    "ios/App/Pods/**",
  ]),
]);

export default eslintConfig;
