import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: ".cache/flowchart-results",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4173/docs/", browserName: "chromium" },
  webServer: {
    command: "node tests/serve.mjs",
    url: "http://127.0.0.1:4173/docs/",
    reuseExistingServer: false,
  },
});
