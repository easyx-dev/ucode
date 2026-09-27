import { defineConfig } from "vitest/config";

/**
 * 测试**直接跑源码**（`dev-src` 条件）；`dist` 只在安装/发布形态下使用。
 *
 * 这里要同时给两个解析器配上条件，少一个就会静默退化成"测 dist"：
 * - `resolve.conditions` 管 Vite 自己处理的模块；
 * - `ssr.resolve.conditions` 管 SSR 运行时的依赖解析——**测试文件里的
 *   `import "@ucode/store"` 走的正是这一条**。只配前者时它会落到 exports 的
 *   `default` → `dist`，于是"源码改了、忘了重新构建"时测试照样通过、什么也没验证
 *   （实测踩过：新加的函数在测试里报 `is not a function`）。
 */
export default defineConfig({
  resolve: { conditions: ["dev-src"] },
  ssr: {
    // 工作区包一律不外部化：交给 Vite 解析到 `src/*.ts` 并即时转译，源码即被测对象。
    noExternal: [/^@ucode\//],
    resolve: { conditions: ["dev-src"] },
  },
  test: {
    environment: "node",
    server: { deps: { inline: [/^@ucode\//] } },
    include: ["{packages,apps,hub}/**/src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    // 门禁自测会 spawn 子进程（依赖边界 / 品牌字面量扫描），比单测慢。
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
