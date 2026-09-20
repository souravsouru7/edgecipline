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
  // Mobile layout guardrails for the consumer app (the admin console is
  // desktop-only and pruned from the mobile bundle, so it is exempt).
  //   - no inline font size below 11px: illegible on 360dp phones and
  //     ignores the Android font-scale setting; use var(--fs-2xs) and up.
  //   - no hard-coded two/three-column grids: they overflow at 320px and
  //     under 200% font scale; use repeat(auto-fit, minmax(..., 1fr)).
  {
    files: ["app/**/*.{js,jsx,tsx}", "features/**/*.{js,jsx,tsx}", "components/**/*.{js,jsx,tsx}"],
    ignores: ["app/admin/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='fontSize'] > Literal[value<11][value>0]",
          message: "Font sizes below 11px are not allowed on mobile screens; use var(--fs-2xs) or larger.",
        },
        {
          selector: "Property[key.name='gridTemplateColumns'] > Literal[value=/^(1fr ){1,2}1fr$/]",
          message: "Use repeat(auto-fit, minmax(<min>px, 1fr)) instead of a fixed 1fr 1fr grid so 320px phones and large font scales reflow.",
        },
      ],
    },
  },
]);

export default eslintConfig;
