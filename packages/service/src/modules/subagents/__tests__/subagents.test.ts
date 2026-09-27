import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { servicePaths } from "../../../paths.ts";
import { findProfile, loadSubagentProfiles } from "../discovery.ts";
import { parseSubagentProfile } from "../profile.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "subagents-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeAgent(name: string, content: string): Promise<void> {
  await mkdir(join(servicePaths(root).piDir, "agents"), { recursive: true });
  await writeFile(join(servicePaths(root).piDir, "agents", name), content);
}

describe("parseSubagentProfile", () => {
  it("解析 frontmatter：内联数组、布尔、数字、正文为系统提示", () => {
    const parsed = parseSubagentProfile(
      [
        "---",
        "name: reviewer",
        "description: 只读审查",
        "tools: [read, grep]",
        "background: true",
        "maxTurns: 12",
        "---",
        "你是一个审查者。",
      ].join("\n"),
      "reviewer.md",
      "reviewer",
    );
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.name).toBe("reviewer");
    expect(parsed.description).toBe("只读审查");
    expect(parsed.tools).toEqual(["read", "grep"]);
    expect(parsed.background).toBe(true);
    expect(parsed.maxTurns).toBe(12);
    expect(parsed.systemPrompt).toBe("你是一个审查者。");
  });

  it("支持块列表形式的 tools", () => {
    const parsed = parseSubagentProfile(
      ["---", "name: a", "description: d", "tools:", "  - read", "  - ls", "---", "正文"].join(
        "\n",
      ),
      "a.md",
      "a",
    );
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.tools).toEqual(["read", "ls"]);
  });

  it("无 description 时报错", () => {
    const parsed = parseSubagentProfile("---\nname: a\n---\n", "a.md", "a");
    expect(typeof parsed).toBe("string");
  });

  it("非法名字报错", () => {
    const parsed = parseSubagentProfile("---\nname: ../evil\n---\n正文", "x.md", "x");
    expect(typeof parsed).toBe("string");
  });

  it("没有 frontmatter 时用文件名作名、正文首行作描述", () => {
    const parsed = parseSubagentProfile("这是首行描述\n\n更多正文", "helper.md", "helper");
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.name).toBe("helper");
    expect(parsed.description).toBe("这是首行描述");
  });
});

describe("loadSubagentProfiles", () => {
  it("内置定义始终可用", async () => {
    const { profiles } = await loadSubagentProfiles(root);
    const names = profiles.map((profile) => profile.name);
    expect(names).toContain("general-purpose");
    expect(names).toContain("explore");
    expect(findProfile(profiles, "explore")?.tools).toContain("read");
  });

  it("用户定义可覆盖同名内置，并能新增", async () => {
    await writeAgent(
      "explore.md",
      ["---", "name: explore", "description: 我的只读探索", "tools: [read]", "---", "自定义"].join(
        "\n",
      ),
    );
    await writeAgent("custom.md", "---\nname: custom\ndescription: 自定义\n---\n正文\n");
    const { profiles, errors } = await loadSubagentProfiles(root);
    expect(errors).toEqual([]);
    expect(findProfile(profiles, "explore")?.description).toBe("我的只读探索");
    expect(findProfile(profiles, "custom")?.description).toBe("自定义");
  });

  it("不合法定义被跳过并留痕，不影响其余", async () => {
    await writeAgent("bad.md", "---\nname: bad\n---\n"); // 缺 description
    await writeAgent("good.md", "---\nname: good\ndescription: ok\n---\n正文\n");
    const { profiles, errors } = await loadSubagentProfiles(root);
    expect(errors).toHaveLength(1);
    expect(profiles.map((profile) => profile.name)).toContain("good");
  });

  it("目录不存在时只有内置", async () => {
    const { profiles } = await loadSubagentProfiles(join(root, "nope"));
    expect(profiles.every((profile) => profile.source.startsWith("builtin:"))).toBe(true);
  });
});
