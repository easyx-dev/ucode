import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectWikiSources } from "./collect.ts";
import {
  filterEntry,
  hasSkippedSegment,
  isBinaryPath,
  isSensitiveName,
  summarizeExclusions,
} from "./filter.ts";
import { buildWikiPrompt } from "./generate.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "wiki-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(relative: string, content = ""): Promise<void> {
  const full = join(root, relative);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

describe("读取过滤规则", () => {
  it("整棵跳过依赖与构建产物目录", () => {
    expect(hasSkippedSegment("node_modules/x/index.js")).toBe(true);
    expect(hasSkippedSegment("packages/a/dist/b.js")).toBe(true);
    expect(hasSkippedSegment("src/.git/config")).toBe(true);
    expect(hasSkippedSegment("src/core/a.ts")).toBe(false);
  });

  it("敏感文件名被排除（宁可少读，不可泄密）", () => {
    for (const name of [
      ".env",
      ".env.local",
      "id_rsa",
      "server.key",
      "cert.pem",
      "credentials.json",
    ]) {
      expect(isSensitiveName(name), name).toBe(true);
    }
    expect(isSensitiveName("env.ts")).toBe(false);
    expect(isSensitiveName("keyboard.ts")).toBe(false);
  });

  it("二进制与资源后缀被排除", () => {
    expect(isBinaryPath("logo.png")).toBe(true);
    expect(isBinaryPath("bundle.min.js")).toBe(true);
    expect(isBinaryPath("main.ts")).toBe(false);
  });

  it("符号链接与超大文件被排除", () => {
    expect(filterEntry({ path: "link.ts", kind: "file", isSymlink: true })).toEqual({
      include: false,
      reason: "symlink",
    });
    expect(
      filterEntry({ path: "big.txt", kind: "file", size: 999_999 }, { maxFileBytes: 1000 }),
    ).toEqual({ include: false, reason: "too-large" });
    expect(filterEntry({ path: "ok.ts", kind: "file", size: 10 })).toEqual({ include: true });
  });

  it("排除摘要按原因聚合", () => {
    const summary = summarizeExclusions([
      { path: "a", reason: "sensitive" },
      { path: "b", reason: "sensitive" },
      { path: "c", reason: "binary" },
    ]);
    expect(summary).toContain("敏感文件 ×2");
    expect(summary).toContain("二进制");
    expect(summarizeExclusions([])).toContain("没有文件被排除");
  });
});

describe("素材收集", () => {
  it("读入选中的文件，排除依赖/敏感/二进制/符号链接", async () => {
    await touch("README.md", "# 项目");
    await touch("src/main.ts", "export const a = 1;");
    await touch(".env", "SECRET=1");
    await touch("node_modules/pkg/index.js", "module.exports = {}");
    await touch("logo.png", "PNGBYTES");
    try {
      await symlink(join(root, "README.md"), join(root, "readme-link.md"));
    } catch {
      // 某些环境不允许建符号链接：跳过这一条断言
    }

    const collection = await collectWikiSources(root);
    const paths = collection.files.map((file) => file.path).sort();
    expect(paths).toEqual(["README.md", "src/main.ts"]);
    expect(collection.files.find((file) => file.path === "README.md")?.content).toContain("# 项目");

    const reasons = collection.excluded.map((item) => item.reason);
    expect(reasons).toContain("sensitive");
    expect(reasons).toContain("skip-dir");
    expect(reasons).toContain("binary");
    expect(collection.truncatedByBudget).toBe(false);
  });

  it("达到文件数预算时明说没读完", async () => {
    for (let index = 0; index < 6; index += 1) await touch(`f${index}.txt`, "x");
    const collection = await collectWikiSources(root, { maxFiles: 2 });
    expect(collection.files).toHaveLength(2);
    expect(collection.truncatedByBudget).toBe(true);
  });
});

describe("生成提示词", () => {
  it("包含文件清单、正文与附加要求", () => {
    const prompt = buildWikiPrompt(
      {
        files: [{ path: "a.ts", content: "const a = 1;", truncated: false }],
        excluded: [],
        totalBytes: 12,
        truncatedByBudget: false,
      },
      "侧重架构",
    );
    expect(prompt).toContain("- a.ts");
    expect(prompt).toContain("const a = 1;");
    expect(prompt).toContain("侧重架构");
  });
});
