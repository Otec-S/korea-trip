import { defineConfig } from "@playwright/test";

// PW_CHROME lets the tests run against an already installed Chrome instead of a downloaded browser
const chrome = process.env.PW_CHROME;

export default defineConfig({
  testDir: "tests",
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    ...(chrome ? { launchOptions: { executablePath: chrome } } : {}),
  },
  webServer: {
    command: "node tests/serve.mjs 5173",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
