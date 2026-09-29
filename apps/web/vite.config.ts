import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { brandHtml } from "./plugins/brand-html.ts";

export default defineConfig({
  plugins: [react(), tailwindcss(), brandHtml()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:2048",
        changeOrigin: true,
      },
    },
  },
});
