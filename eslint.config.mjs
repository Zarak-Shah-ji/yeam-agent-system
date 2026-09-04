import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Listing globalIgnores REPLACES eslint-config-next's defaults, so everything
  // it used to skip has to be repeated here. `.vercel/` is the one that bites:
  // a local `vercel build` drops minified bundles there, and linting them
  // produced 3,400 warnings and 37 errors that had nothing to do with the
  // source. CI never saw it — a fresh checkout has no .vercel — so `pnpm lint`
  // failed only on the machines of people trying to run it before pushing.
  globalIgnores([
    ".next/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
