/** harness/setup/assets：目录优先级与命令 / 技能装载 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { PROJECT_CONFIG_DIRNAME } from "../../../../constants/dirs";
import { loadCommandAssets } from "..";
import { commandAssetPaths } from "../paths";

const created: string[] = [];

const makeTemp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "brand-assets-"));
  created.push(dir);
  return dir;
};

/** 写入一个技能（目录 + SKILL.md） */
const writeSkill = (dir: string, id: string, description: string): void => {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(
    join(dir, id, "SKILL.md"),
    `---\nname: ${id}\ndescription: ${description}\n---\n\n正文\n`,
    "utf8",
  );
};

/** 写入一个提示词命令 */
const writePrompt = (dir: string, name: string, description: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.md`),
    `---\ndescription: ${description}\n---\n\n${name}\n`,
    "utf8",
  );
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("commandAssetPaths", () => {
  it("按 项目配置目录 > 项目 .agents > 全局 > 用户 排序", () => {
    const root = makeTemp();
    const appHome = makeTemp();
    const userHome = makeTemp();
    const cwd = join(root, "sub");

    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    mkdirSync(join(root, PROJECT_CONFIG_DIRNAME, "skills"), { recursive: true });
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    mkdirSync(join(appHome, "skills"), { recursive: true });
    mkdirSync(join(userHome, ".agents", "skills"), { recursive: true });

    const paths = commandAssetPaths({ cwd, appHome, userHome });
    assert.deepEqual(
      paths.skills.map((item) => item.source),
      ["project", "agents-project", "global", "agents-user"],
    );
  });

  it("提示词只取项目配置目录与全局，不含 .agents", () => {
    const root = makeTemp();
    const appHome = makeTemp();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, PROJECT_CONFIG_DIRNAME, "prompts"), { recursive: true });
    mkdirSync(join(appHome, "prompts"), { recursive: true });
    mkdirSync(join(root, ".agents", "prompts"), { recursive: true });

    const paths = commandAssetPaths({ cwd: root, appHome, userHome: makeTemp() });
    assert.deepEqual(
      paths.prompts.map((item) => item.source),
      ["project", "global"],
    );
  });

  it("插件资产排在用户档之后、内置之前", () => {
    const root = makeTemp();
    const appHome = makeTemp();
    const userHome = makeTemp();
    const pluginSkills = makeTemp();
    const pluginPrompts = makeTemp();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, PROJECT_CONFIG_DIRNAME, "skills"), { recursive: true });
    mkdirSync(join(appHome, "skills"), { recursive: true });
    mkdirSync(join(userHome, ".agents", "skills"), { recursive: true });
    mkdirSync(join(appHome, "prompts"), { recursive: true });

    const paths = commandAssetPaths({
      cwd: root,
      appHome,
      userHome,
      plugin: { skills: [pluginSkills], prompts: [pluginPrompts] },
    });

    assert.deepEqual(
      paths.skills.map((item) => item.source),
      ["project", "global", "agents-user", "plugin"],
    );
    assert.deepEqual(
      paths.prompts.map((item) => item.source),
      ["global", "plugin"],
    );
  });
});

describe("loadCommandAssets", () => {
  const layout = () => {
    const root = makeTemp();
    const appHome = makeTemp();
    const userHome = makeTemp();
    mkdirSync(join(root, ".git"), { recursive: true });
    return { root, appHome, userHome };
  };

  it("列出技能与命令并标注来源", async () => {
    const { root, appHome, userHome } = layout();
    writeSkill(join(root, PROJECT_CONFIG_DIRNAME, "skills"), "pdf", "PDF 工具");
    writeSkill(join(appHome, "skills"), "global-skill", "全局技能");
    writePrompt(join(root, PROJECT_CONFIG_DIRNAME, "prompts"), "review", "代码审查");
    writePrompt(join(appHome, "prompts"), "explain", "解释代码");

    const assets = await loadCommandAssets({
      cwd: root,
      appHome,
      userHome,
      harnessDir: makeTemp(),
    });

    assert.deepEqual(
      assets.skills.map((skill) => [skill.name, skill.source]),
      [
        ["pdf", "project"],
        ["global-skill", "global"],
      ],
    );
    assert.deepEqual(
      assets.prompts.map((prompt) => [prompt.name, prompt.source]),
      [
        ["review", "project"],
        ["explain", "global"],
      ],
    );
  });

  it("同名时项目级覆盖全局", async () => {
    const { root, appHome, userHome } = layout();
    writeSkill(join(root, PROJECT_CONFIG_DIRNAME, "skills"), "dup", "项目版");
    writeSkill(join(appHome, "skills"), "dup", "全局版");

    const assets = await loadCommandAssets({
      cwd: root,
      appHome,
      userHome,
      harnessDir: makeTemp(),
    });

    assert.equal(assets.skills.length, 1);
    assert.equal(assets.skills[0]?.name, "dup");
    assert.equal(assets.skills[0]?.description, "项目版");
    assert.equal(assets.skills[0]?.source, "project");
  });

  it("没有资源目录时只剩内置命令", async () => {
    const { root, appHome, userHome } = layout();
    const assets = await loadCommandAssets({
      cwd: root,
      appHome,
      userHome,
      harnessDir: makeTemp(),
    });
    assert.deepEqual(assets.skills, []);
    assert.deepEqual(
      assets.prompts.map((prompt) => [prompt.name, prompt.source]),
      [["review", "builtin"]],
    );
  });

  it("磁盘上的同名命令覆盖内置命令，内置来源只补空缺", async () => {
    const { root, appHome, userHome } = layout();
    writePrompt(join(root, PROJECT_CONFIG_DIRNAME, "prompts"), "review", "项目版审查");

    const assets = await loadCommandAssets({
      cwd: root,
      appHome,
      userHome,
      harnessDir: makeTemp(),
    });

    assert.deepEqual(
      assets.prompts.map((prompt) => [prompt.name, prompt.source, prompt.description]),
      [["review", "project", "项目版审查"]],
    );
  });

  it("插件贡献的技能与命令进 `/` 菜单，来源标 plugin，且用户同名仍胜出", async () => {
    const { root, appHome, userHome } = layout();
    const pluginSkills = makeTemp();
    const pluginPrompts = makeTemp();
    writeSkill(pluginSkills, "audit", "插件技能");
    writePrompt(pluginPrompts, "audit", "插件命令");
    // 用户自己写了同名命令：应当胜出
    writePrompt(join(appHome, "prompts"), "audit", "用户命令");

    const assets = await loadCommandAssets({
      cwd: root,
      appHome,
      userHome,
      harnessDir: makeTemp(),
      plugin: { skills: [pluginSkills], prompts: [pluginPrompts] },
    });

    assert.deepEqual(
      assets.skills.map((skill) => [skill.name, skill.source]),
      [["audit", "plugin"]],
    );
    assert.deepEqual(
      assets.prompts.map((prompt) => [prompt.name, prompt.source]),
      [
        ["audit", "global"],
        ["review", "builtin"],
      ],
    );
    assert.equal(assets.prompts.find((prompt) => prompt.name === "audit")?.description, "用户命令");
  });
});
