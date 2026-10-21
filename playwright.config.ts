import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? undefined : "chrome",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --port 3100",
    url: "http://127.0.0.1:3100/fr",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
