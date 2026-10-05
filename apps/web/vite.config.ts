import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { brandHtml } from "@ucode/brand/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:2048",
        changeOrigin: true,
      },
    },
  },
  build: {
    // vite 8 走 rolldown。编辑器内核（Tiptap / ProseMirror）与 Markdown 渲染链
    // 体积最大且相对独立，拆成各自 chunk：主 chunk 不再被顶到 1MB 以上，也便于缓存
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
