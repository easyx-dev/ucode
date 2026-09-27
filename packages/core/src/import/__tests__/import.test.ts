import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  destinationFor,
  importExternalSources,
  summarizeImport,
  withProvenance,
} from "../apply.ts";
import { discoverExternalSources, kindLabel } from "../sources.ts";

let root: string;
let dataDir: string;
let external: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "import-test-"));
  dataDir = join(root, "data");
  external = join(root, "external");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(relative: string, content = ""): Promise<void> {
  const full = join(external, relative);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

async function makeClaudeLayout(): Promise<void> {
  await touch("AGENTS.md", "# 项目约定\n\n用 pnpm。\n");
  await touch("commands/review.md", "---\ndescription: 审查\n---\n请审查这段代码。\n");
  await touch("agents/helper.md", "---\nname: helper\ndescription: 帮手\n---\n你是帮手。\n");
  await touch("skills/pdf/SKILL.md", "---\nname: pdf\ndescription: 处理 PDF\n---\n读 PDF。\n");
  await touch(
    ".claude-plugin/plugin.json",
    JSON.stringify({ name: "demo", mcpServers: { fs: {}, git: {} } }),
  );
  await touch(".mcp.json", JSON.stringify({ mcpServers: { sqlite: {} } }));
  await touch(".agents/commands/ping.md", "ping\n");
}

describe("外部布局发现", () => {
  describe("discoverExternalSources", () => {
    it("认出 Claude 系与 .agents 布局的各类资源", async () => {
      await makeClaudeLayout();
      const found = await discoverExternalSources(external);
      const byKind = (kind: string) =>
        found.filter((source) => source.kind === kind).map((s) => s.name);

      expect(byKind("context")).toEqual(["AGENTS"]);
      expect(byKind("command").sort()).toEqual(["ping", "review"]);
      expect(byKind("agent")).toEqual(["helper"]);
      expect(byKind("skill")).toEqual(["pdf"]);
      expect(
        found
          .filter((source) => source.kind === "mcp")
          .map((s) => s.name)
          .sort(),
      ).toEqual(["claude-plugin", "mcp"]);
      expect(found.find((source) => source.name === "ping")?.origin).toBe("agents");
      expect(found.find((source) => source.name === "review")?.origin).toBe("claude");
    });

    it("没有可识别内容时返回空表", async () => {
      await mkdir(external, { recursive: true });
      expect(await discoverExternalSources(external)).toEqual([]);
    });
  });

  describe("kindLabel", () => {
    it("类别有中文标签", () => {
      expect(kindLabel("skill")).toBe("技能");
      expect(kindLabel("mcp")).toBe("MCP 声明");
    });
  });
});

describe("withProvenance", () => {
  it("没有 frontmatter 时新建一段", () => {
    const marked = withProvenance("正文", { origin: "claude", relativePath: "commands/a.md" });
    expect(marked.startsWith("---\n")).toBe(true);
    expect(marked).toContain("importedFrom: commands/a.md");
    expect(marked).toContain("importOrigin: claude");
    expect(marked).toContain("正文");
  });

  it("已有 frontmatter 时并进去，不覆盖原字段", () => {
    const marked = withProvenance("---\ndescription: 审查\n---\n正文", {
      origin: "agents",
      relativePath: "x.md",
    });
    expect(marked).toContain("description: 审查");
    expect(marked).toContain("importedFrom: x.md");
  });

  it("已标记过的不重复叠加（重复导入同一份）", () => {
    const once = withProvenance("---\nimportedFrom: a.md\n---\n正文", {
      origin: "claude",
      relativePath: "a.md",
    });
    expect(once.match(/importedFrom/gu)).toHaveLength(1);
  });
});

describe("导入落盘", () => {
  describe("importExternalSources", () => {
    it("复制进数据层对应位置，且**源目录分毫未动**", async () => {
      await makeClaudeLayout();
      const sourceBefore = await readFile(join(external, "commands", "review.md"), "utf8");

      const report = await importExternalSources({ dataDir, root: external });
      const imported = report.imported.map((entry) => entry.kind).sort();
      expect(imported).toEqual(["agent", "command", "command", "context", "skill"]);
      expect(report.mcp.flatMap((entry) => entry.servers).sort()).toEqual(["fs", "git", "sqlite"]);

      const command = await readFile(join(dataDir, "prompts", "review.md"), "utf8");
      expect(command).toContain("importedFrom: commands/review.md");
      expect(await readFile(join(dataDir, "skills", "pdf", "SKILL.md"), "utf8")).toContain(
        "读 PDF。",
      );
      expect(await readFile(join(dataDir, "agents", "helper.md"), "utf8")).toContain("你是帮手。");

      // 源目录没被改动（这是我们承诺的"不改原配置"）。
      expect(await readFile(join(external, "commands", "review.md"), "utf8")).toBe(sourceBefore);

      const mcp = JSON.parse(await readFile(join(dataDir, "imported-mcp.json"), "utf8")) as {
        registrations: unknown[];
      };
      expect(mcp.registrations.length).toBeGreaterThan(0);
    });

    it("已存在时跳过，除非显式 overwrite", async () => {
      await makeClaudeLayout();
      await importExternalSources({ dataDir, root: external });
      // 改掉目标文件，模拟用户自己改过
      await writeFile(join(dataDir, "prompts", "review.md"), "我自己的审查命令");

      const second = await importExternalSources({ dataDir, root: external });
      expect(
        second.skipped.some((entry) => entry.name === "review" && entry.reason === "exists"),
      ).toBe(true);
      expect(await readFile(join(dataDir, "prompts", "review.md"), "utf8")).toBe(
        "我自己的审查命令",
      );

      await importExternalSources({ dataDir, root: external, overwrite: true });
      expect(await readFile(join(dataDir, "prompts", "review.md"), "utf8")).toContain(
        "请审查这段代码",
      );
    });

    it("只导入指定类别", async () => {
      await makeClaudeLayout();
      const report = await importExternalSources({ dataDir, root: external, kinds: ["skill"] });
      expect(report.imported.map((entry) => entry.kind)).toEqual(["skill"]);
    });
  });

  describe("destinationFor", () => {
    it("目的地按类别映射", () => {
      expect(
        destinationFor("/d", {
          kind: "command",
          name: "review",
          path: "/x",
          relativePath: "commands/review.md",
          origin: "claude",
        }),
      ).toBe("/d/prompts/review.md");
      expect(summarizeImport({ imported: [], skipped: [], mcp: [] })).toContain("导入 0 项");
    });
  });
});
