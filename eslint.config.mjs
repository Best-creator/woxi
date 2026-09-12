import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".next.stale-*/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "test-results.stale-*/**",
    "node_modules.broken/**",
    ".data/**",
    "work/ms-playwright/**",
    "next-env.d.ts"
  ])
]);

