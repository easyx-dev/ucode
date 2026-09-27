import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Web 壳的构建配置。
 *
 * 产物由服务层的 HTTP 绑定在同源下发布（CLI 的 web 子命令），因此 `base: "./"`——
 * 静态资源用相对路径，放在任何前缀下都能加载。
 */
export default defineConfig({
  base: "./",
  // 优先 source 条件：开发态打包源码（dist 是给「以包安装」形态用的产物）。
  resolve: { conditions: ["dev-src"] },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
