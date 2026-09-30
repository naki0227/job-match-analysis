import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],

    server: {
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
        // Share pages and OG images are rendered by the API (Issue #39).
        "/s/": { target: env.API_PROXY_TARGET },
      },
    },

    test: {
      environment: "jsdom",
      setupFiles: ["./tests/setup.ts"],
    },
  };
});
