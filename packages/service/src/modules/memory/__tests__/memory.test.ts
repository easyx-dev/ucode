import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSafeMemoryName, projectMemoryDir, projectMemoryKey } from "../paths.ts";
import { buildMemoryPrompt } from "../prompt.ts";
import { parseMemoryFact, serializeMemoryFact } from "../record.ts";
import {
  deleteMemoryFact,
  listMemoryFacts,
  readMemoryFact,
  readMemoryIndex,
  writeMemoryFact,
} from "../store.ts";

let root: string;
let dir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "memory-test-"));
  dir = projectMemoryDir(join(root, "memories"), "/work/project");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("记忆路径", () => {
  describe("projectMemoryKey", () => {
    it("同名工作区不同路径不互相覆盖", () => {
      const a = projectMemoryKey("/home/a/api");
      const b = projectMemoryKey("/home/b/api");
      expect(a.startsWith("api-")).toBe(true);
      expect(b.startsWith("api-")).toBe(true);
      expect(a).not.toBe(b);
    });

    it("同一 cwd 稳定映射到同一目录", () => {
      expect(projectMemoryKey("/x/y")).toBe(projectMemoryKey("/x/y"));
    });
  });

  describe("isSafeMemoryName", () => {
    it("条目名校验拒绝路径与保留名", () => {
      expect(isSafeMemoryName("build-conventions")).toBe(true);
      expect(isSafeMemoryName("a/b")).toBe(false);
      expect(isSafeMemoryName("MEMORY")).toBe(false);
      expect(isSafeMemoryName("有中文")).toBe(false);
    });
  });
});

describe("记忆条目读写", () => {
  describe("writeMemoryFact", () => {
    it("写入后能读回，并生成派生索引", async () => {
      await writeMemoryFact(dir, {
        name: "build",
        description: "构建用 pnpm check",
        type: "feedback",
        body: "改动前先跑 pnpm check。",
      });
      const fact = await readMemoryFact(dir, "build");
      expect(fact?.name).toBe("build");
      expect(fact?.type).toBe("feedback");
      expect(fact?.body).toContain("pnpm check");

      const index = await readMemoryIndex(dir);
      expect(index).toContain("[build](build.md)");
      expect(index).toContain("构建用 pnpm check");
    });

    it("非法条目名被拒绝", async () => {
      await expect(
        writeMemoryFact(dir, { name: "../escape", description: "x", body: "x" }),
      ).rejects.toThrow();
    });
  });

  describe("listMemoryFacts", () => {
    it("列出全部条目并按名字排序", async () => {
      await writeMemoryFact(dir, { name: "zeta", description: "z", body: "z" });
      await writeMemoryFact(dir, { name: "alpha", description: "a", body: "a" });
      const facts = await listMemoryFacts(dir);
      expect(facts.map((f) => f.name)).toEqual(["alpha", "zeta"]);
    });

    it("目录不存在时列出为空（记忆是可选能力）", async () => {
      expect(await listMemoryFacts(join(root, "nope"))).toEqual([]);
    });
  });

  describe("deleteMemoryFact", () => {
    it("删除后索引同步收缩", async () => {
      await writeMemoryFact(dir, { name: "tmp", description: "临时", body: "x" });
      expect(await deleteMemoryFact(dir, "tmp")).toBe(true);
      expect(await readMemoryFact(dir, "tmp")).toBeNull();
      expect(await readMemoryIndex(dir)).toContain("(空)");
    });
  });
});

describe("buildMemoryPrompt", () => {
  it("空记忆不产生 section", () => {
    expect(buildMemoryPrompt([])).toBeNull();
  });

  it("只注索引（名字 + 描述），不含正文", async () => {
    await writeMemoryFact(dir, {
      name: "a",
      description: "desc-a",
      body: "BODY-SHOULD-NOT-APPEAR",
    });
    const facts = await listMemoryFacts(dir);
    const prompt = buildMemoryPrompt(facts);
    expect(prompt).toContain("a — desc-a");
    expect(prompt).not.toContain("BODY-SHOULD-NOT-APPEAR");
  });

  it("超行数上限时截断并提示", () => {
    const facts = Array.from({ length: 300 }, (_, i) => ({
      name: `f${i}`,
      description: "d",
      type: "project" as const,
      body: "",
      file: "",
      updatedAt: "",
    }));
    const prompt = buildMemoryPrompt(facts, { maxLines: 50 });
    expect(prompt).toContain("截断");
    expect(prompt?.split("\n").length).toBeLessThan(60);
  });
});

describe("frontmatter 往返", () => {
  describe("serializeMemoryFact", () => {
    it("序列化再解析保持一致", () => {
      const serialized = serializeMemoryFact({
        name: "x",
        description: '带 "引号" 的描述',
        type: "reference",
        body: "正文\n第二行",
      });
      const parsed = parseMemoryFact("/tmp/x.md", serialized, "2020-01-01T00:00:00.000Z");
      expect(parsed.name).toBe("x");
      expect(parsed.description).toBe('带 "引号" 的描述');
      expect(parsed.type).toBe("reference");
      expect(parsed.body).toBe("正文\n第二行");
    });
  });

  describe("parseMemoryFact", () => {
    it("缺少 frontmatter 时退化为纯正文", () => {
      const parsed = parseMemoryFact(
        "/tmp/y.md",
        "就是一段话\n还有一行",
        "2020-01-01T00:00:00.000Z",
      );
      expect(parsed.description).toBe("就是一段话");
      expect(parsed.type).toBe("project");
    });
  });
});

describe("writeMemoryFact", () => {
  it("写入的是 Markdown 文件（人可手改）", async () => {
    await writeMemoryFact(dir, { name: "note", description: "d", body: "内容" });
    const raw = await readFile(join(dir, "note.md"), "utf8");
    expect(raw.startsWith("---\n")).toBe(true);
    expect(raw).toContain('name: "note"');
  });
});
