import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { brandHtml } from "./plugins/brand-html.ts";

export default defineConfig({
  plugins: [
    devtools({
      // 只保留源码位置注入，关掉其余联动，避免改写 console 行为、另起事件总线端口
      consolePiping: { enabled: false },
      enhancedLogs: { enabled: false },
      eventBusConfig: { enabled: false },
      injectSource: {
        enabled: true,
        ignore: {
          // 排除基础 UI 组件：它们会把 data-tsd-source 透传到内部宿主元素，
          // 让 Elements 面板定位到组件库实现而非业务调用处
          components: [
            /^(Button|Input|Select|Dialog|Tooltip|DropdownMenu|Collapsible|Badge|Separator|ScrollArea|ScrollBar|Skeleton|Label|Toaster)/,
          ],
        },
      },
    }),
    react(),
    tailwindcss(),
    brandHtml(),
  ],
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
