import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "playwright-smoke.spec.ts",
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
  reporter: "list"
});

