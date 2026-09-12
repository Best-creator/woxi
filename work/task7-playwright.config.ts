import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 1000 },
        permissions: ["clipboard-read", "clipboard-write"]
      }
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        channel: "chrome",
        viewport: { width: 390, height: 844 }
      }
    }
  ]
});
