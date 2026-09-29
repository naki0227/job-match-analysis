import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      API_PROXY_TARGET: "http://127.0.0.1:9",
      VITE_SUPABASE_URL: "https://e2e.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_fixture",
    },
  },
});
