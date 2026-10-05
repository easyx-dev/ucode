import tailwindcss from "@tailwindcss/vite";
import { brandHtml } from "@ucode/brand/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // 打包后由 Electron 以本地文件加载，资源用相对路径
  base: "./",
  plugins: [react(), tailwindcss(), brandHtml()],
  server: {
    // 桌面渲染层的固定来源：服务端 CORS 白名单据此放行（见 .env.example）
    port: 5174,
    strictPort: true,
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
              test: /node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast-|hast-|unist-|unified|vfile|property-information|space-separated-tokens|comma-separated-tokens|character-entities|decode-named-character-reference|trim-lines|devlop|zwitch|longest-streak|ccount|escape-string-regexp|markdown-table|bail|trough|is-plain-obj|html-url-attributes)/,
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
});
