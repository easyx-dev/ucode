import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { brandHtml } from "@ucode/brand/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/** 从 start 向上找含 pnpm-workspace.yaml 的仓库根（`.env` 所在处），不依赖当前运行目录 */
const findRepoRoot = (start: string): string => {
  let current = start;
  for (;;) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) return current;
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
};

export default defineConfig(({ command, mode }) => {
  // 开发代理要指向服务端口，该端口由环境变量声明（见 .env），不在代码里写死。
  // 与 apps/web/vite.config.ts 同口径：缺值直接报错，不静默不挂代理——静默的话 `/api/*` 会落到
  // 渲染层自己的 dev server 上，报出来的是「服务返回了非 JSON 响应」，与真实原因差很远。
  const { APP_PORT } = loadEnv(mode, findRepoRoot(process.cwd()), "");
  if (command === "serve" && !(Number(APP_PORT) > 0)) {
    throw new Error("桌面端开发代理需要 .env 声明具体的 APP_PORT（正整数）指向服务端口");
  }

  return {
    // 生产形态下由 Electron 以 `app://` 加载，资源用相对路径
    base: "./",
    plugins: [react(), tailwindcss(), brandHtml()],
    server: {
      // 桌面渲染层的固定来源（开发）；生产形态下渲染层走 `app://`，两边都不需要服务端放开跨域
      port: 5174,
      strictPort: true,
      // 与会话同源：页面发出的 `/api/*` 由这里转给本机服务（令牌由主进程加在请求头上，见 src/main/index.ts）
      proxy: { "/api": { target: `http://127.0.0.1:${APP_PORT}`, changeOrigin: true } },
    },
    build: {
      // 与 web 同口径：编辑器内核与 Markdown 渲染链各自成 chunk
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "editor", test: /node_modules[\\/](@tiptap|prosemirror)/ },
              {
                name: "markdown",
                test: /node_modules[\\/](streamdown|marked|remend|remark-|rehype-|micromark|mdast-|hast-|unist-|unified|vfile|property-information|space-separated-tokens|comma-separated-tokens|character-entities|decode-named-character-reference|trim-lines|devlop|zwitch|longest-streak|ccount|escape-string-regexp|markdown-table|bail|trough|is-plain-obj|html-url-attributes)/,
              },
              {
                name: "ui",
                test: /node_modules[\\/](radix-ui|@radix-ui|@floating-ui|cmdk|sonner|lucide-react|class-variance-authority|clsx|tailwind-merge)/,
              },
              {
                name: "react",
                test: /node_modules[\\/](react|react-dom|scheduler|react-i18next|i18next)(?=[\\/])/,
              },
            ],
          },
        },
      },
    },
  };
});
