import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { servicePaths } from "../../../paths.ts";
import { parseEntry, readCatalog } from "../catalog.ts";
import { installPlugin, listInstalled, summarizeInstall, uninstallPlugin } from "../install.ts";
import { addSource, listSources, normalizeSource, removeSource } from "../sources.ts";

let root: string;
let dataDir: string;
let marketDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "market-test-"));
  dataDir = join(root, "data");
  marketDir = join(root, "market");
  await mkdir(dataDir, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 造一个本机市场：一个插件，含技能/提示/子智能体三种组件。 */
async function makePluginDir(): Promise<void> {
  const plugin = join(marketDir, "demo");
  await mkdir(join(plugin, "skills", "pdf"), { recursive: true });
  await mkdir(join(plugin, "commands"), { recursive: true });
  await mkdir(join(plugin, "agents"), { recursive: true });
  await writeFile(
    join(plugin, "plugin.json"),
    JSON.stringify({
      name: "demo",
      version: "1.0.0",
      description: "演示插件",
      components: {
        skills: [{ name: "pdf", file: "skills/pdf/SKILL.md" }],
        prompts: [{ name: "review", file: "commands/review.md" }],
        agents: [{ name: "helper", file: "agents/helper.md" }],
      },
    }),
  );
  await writeFile(join(plugin, "skills", "pdf", "SKILL.md"), "---\nname: pdf\n---\n读 PDF。\n");
  await writeFile(join(plugin, "commands", "review.md"), "---\ndescription: 审查\n---\n请审查。\n");
  await writeFile(
    join(plugin, "agents", "helper.md"),
    "---\nname: helper\ndescription: 帮手\n---\n你是帮手。\n",
  );
}

describe("市场源注册表", () => {
  describe("addSource", () => {
    it("登记/列出/移除；remote 必须是 http(s)", async () => {
      await addSource(dataDir, { name: "official", kind: "local", location: marketDir });
      await expect(
        addSource(dataDir, { name: "bad", kind: "remote", location: "/tmp/x" }),
      ).rejects.toThrow();
      await addSource(dataDir, { name: "remote-ok", kind: "remote", location: "https://x/m.json" });

      expect((await listSources(dataDir)).map((source) => source.name)).toEqual([
        "official",
        "remote-ok",
      ]);
      expect(await removeSource(dataDir, "official")).toBe(true);
      expect(await removeSource(dataDir, "official")).toBe(false);
    });
  });

  describe("normalizeSource", () => {
    it("非法源名被拒", () => {
      expect(() => normalizeSource({ name: "bad name", kind: "local", location: "/x" })).toThrow();
    });
  });
});

describe("目录读取", () => {
  describe("readCatalog", () => {
    it("本机源扫子目录里的 plugin.json", async () => {
      await makePluginDir();
      const entries = await readCatalog({ name: "m", kind: "local", location: marketDir });
      expect(entries.map((entry) => entry.name)).toEqual(["demo"]);
      expect(entries[0]?.components.map((component) => component.kind)).toEqual([
        "skill",
        "prompt",
        "agent",
      ]);
    });

    it("远程源按清单读（注入 fetch，不联网）", async () => {
      const entries = await readCatalog(
        { name: "r", kind: "remote", location: "https://x/marketplace.json" },
        {
          fetchJson: async () => ({
            plugins: [
              {
                name: "remote-plugin",
                version: "2.0.0",
                components: {
                  skills: [{ name: "s", url: "https://x/s/SKILL.md" }],
                },
              },
            ],
          }),
        },
      );
      expect(entries[0]?.name).toBe("remote-plugin");
      expect(entries[0]?.components[0]?.url).toBe("https://x/s/SKILL.md");
    });

    it("目录不存在时返回空表", async () => {
      expect(await readCatalog({ name: "m", kind: "local", location: join(root, "nope") })).toEqual(
        [],
      );
    });
  });

  describe("parseEntry", () => {
    it("没有 name 的清单条目被丢弃；组件缺 file/url 也丢", () => {
      expect(parseEntry({ components: {} }, "s")).toBeNull();
      const entry = parseEntry(
        {
          name: "ok",
          components: { skills: [{ name: "no-file" }, { name: "good", file: "a.md" }] },
        },
        "s",
      );
      expect(entry?.components.map((component) => component.name)).toEqual(["good"]);
    });
  });
});

describe("安装与卸载", () => {
  describe("installPlugin", () => {
    it("装进数据层对应位置，并给 Markdown 写上来源", async () => {
      await makePluginDir();
      const source = { name: "official", kind: "local" as const, location: marketDir };
      const entry = (await readCatalog(source))[0];
      expect(entry).toBeDefined();
      if (entry === undefined) return;

      const report = await installPlugin({ dataDir, source, entry });
      expect(report.installed).toHaveLength(3);
      expect(summarizeInstall(report)).toContain("装好 3 项");

      const skill = await readFile(
        join(servicePaths(dataDir).piDir, "skills", "pdf", "SKILL.md"),
        "utf8",
      );
      expect(skill).toContain("importedFrom: official/demo/skills/pdf/SKILL.md");
      expect(skill).toContain("读 PDF。");
      expect(
        await readFile(join(servicePaths(dataDir).piDir, "prompts", "review.md"), "utf8"),
      ).toContain("请审查。");
      expect(
        await readFile(join(servicePaths(dataDir).piDir, "agents", "helper.md"), "utf8"),
      ).toContain("你是帮手。");

      // 源目录没被动过。
      expect(await readFile(join(marketDir, "demo", "commands", "review.md"), "utf8")).toContain(
        "请审查。",
      );
    });

    it("已存在默认跳过；overwrite 才覆盖", async () => {
      await makePluginDir();
      const source = { name: "official", kind: "local" as const, location: marketDir };
      const entry = (await readCatalog(source))[0];
      if (entry === undefined) return;
      await installPlugin({ dataDir, source, entry });
      await writeFile(join(servicePaths(dataDir).piDir, "prompts", "review.md"), "我自己的\n");

      const second = await installPlugin({ dataDir, source, entry });
      expect(second.skipped).toHaveLength(3);
      expect(
        await readFile(join(servicePaths(dataDir).piDir, "prompts", "review.md"), "utf8"),
      ).toBe("我自己的\n");

      await installPlugin({ dataDir, source, entry, overwrite: true });
      expect(
        await readFile(join(servicePaths(dataDir).piDir, "prompts", "review.md"), "utf8"),
      ).toContain("请审查。");
    });

    it("远程组件用 url 取内容（注入 fetchText）", async () => {
      const source = { name: "remote", kind: "remote" as const, location: "https://x/m.json" };
      const entry = parseEntry(
        { name: "r", components: { prompts: [{ name: "fromUrl", url: "https://x/p.md" }] } },
        "remote",
      );
      if (entry === null) return;
      const report = await installPlugin({
        dataDir,
        source,
        entry,
        fetchText: async (url) => `来自 ${url}\n`,
      });
      expect(report.installed).toHaveLength(1);
      expect(
        await readFile(join(servicePaths(dataDir).piDir, "prompts", "fromUrl.md"), "utf8"),
      ).toContain("https://x/p.md");
    });
  });

  describe("listInstalled", () => {
    it("已装资源可枚举，卸载只删对应路径", async () => {
      await makePluginDir();
      const source = { name: "official", kind: "local" as const, location: marketDir };
      const entry = (await readCatalog(source))[0];
      if (entry === undefined) return;
      await installPlugin({ dataDir, source, entry });

      const installed = await listInstalled(dataDir);
      expect(
        installed.some((resource) => resource.kind === "skill" && resource.name === "pdf"),
      ).toBe(true);

      const removed = await uninstallPlugin({ dataDir, kind: "skill", name: "pdf" });
      expect(removed.removed).toBe(true);
      const after = await listInstalled(dataDir);
      expect(after.some((resource) => resource.name === "pdf")).toBe(false);
      // 只删了技能，提示仍在。
      expect(after.some((resource) => resource.name === "review")).toBe(true);
    });
  });
});
