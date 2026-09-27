import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 桌面壳渲染进程的构建。
 *
 * 产物由 Electron 主进程以 file:// 加载，因此 `base: "./"`（相对路径在 file:// 下才能解析）。
 * 只构建渲染进程；主进程与 preload 是纯 .mjs，Electron 直接加载。
 */
export default defineConfig({
  base: "./",
  // 优先 source 条件：开发态打包源码（dist 是给「以包安装」形态用的产物）。
  resolve: { conditions: ["dev-src"] },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
});
