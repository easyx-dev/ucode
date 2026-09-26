import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{packages,apps,hub}/**/src/**/*.{test,spec}.ts", "tests/**/*.{test,spec}.ts"],
    // 门禁自测会 spawn 子进程（依赖边界 / 品牌字面量扫描），比单测慢。
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
