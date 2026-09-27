import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverResources } from "../discovery.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plugins-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function touch(relative: string, content = ""): Promise<void> {
  const full = join(root, relative);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
}

describe("discoverResources", () => {
  it("发现扩展（单文件 + 含 index 的目录）", async () => {
    await touch("extensions/echo.ts");
    await touch("extensions/multi/index.ts");
    await touch("extensions/readme.md"); // 非扩展文件被忽略
    const found = await discoverResources(root);
    const extensions = found.filter((resource) => resource.kind === "extension");
    expect(extensions.map((resource) => resource.name).sort()).toEqual(["echo", "multi"]);
    expect(extensions.find((resource) => resource.name === "multi")?.entry).toBe("directory");
  });

  it("发现技能（含 SKILL.md 的目录）", async () => {
    await touch("skills/pdf/SKILL.md", "---\nname: pdf\n---\n");
    await touch("skills/loose/SKILL.md");
    await touch("skills/nope/readme.md"); // 缺 SKILL.md 被忽略
    const skills = (await discoverResources(root)).filter((resource) => resource.kind === "skill");
    expect(skills.map((resource) => resource.name).sort()).toEqual(["loose", "pdf"]);
  });

  it("发现提示模板与主题", async () => {
    await touch("prompts/review.md");
    await touch("themes/dark.json", "{}");
    await touch("prompts/not-a-prompt.txt");
    const found = await discoverResources(root);
    expect(found.find((resource) => resource.kind === "prompt")?.name).toBe("review");
    expect(found.find((resource) => resource.kind === "theme")?.name).toBe("dark");
  });

  it("目录不存在时返回空表（资源是可选能力）", async () => {
    expect(await discoverResources(join(root, "nothing-here"))).toEqual([]);
  });
});
