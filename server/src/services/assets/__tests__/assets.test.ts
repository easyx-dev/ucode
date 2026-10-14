/**
 * 资产服务：落点解析、来源门控、内容校验、额外 frontmatter 行的保留与技能目录的整体删除。
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";

import { brand } from "@ucode/brand/values";
import { type AssetsSaveInput, ERROR_CODES } from "@ucode/contracts";

import { PROJECT_CONFIG_DIRNAME } from "../../../constants/dirs";
import { AppError } from "../../../platform/response";
import { type AssetContext, deleteAsset, listAssets, readAsset, saveAsset } from "..";
import { assetPathInfo } from "../paths";

const root = mkdtempSync(join(tmpdir(), `${brand.slug}-assets-`));
const appHome = join(root, "home");
const userHome = join(root, "user");
const project = join(root, "project");

after(() => rmSync(root, { recursive: true, force: true }));

const contextOf = (cwd = project): AssetContext => ({ cwd, appHome, userHome });

const isCode = (error: unknown, code: string): boolean =>
  error instanceof AppError && error.code === code;

const writeFileAt = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

describe("assets 服务", () => {
  it("全局档新建角色：落到 $APP_HOME/agents，列表与详情都能读回", () => {
    const saved = saveAsset(contextOf(), {
      kind: "agent",
      name: "code-reviewer",
      scope: "global",
      label: "代码审查",
      description: "只读审查改动",
      mode: "subagent",
      tools: ["read", "grep"],
      body: "审查改动时先看 diff，再给结论。",
    } satisfies AssetsSaveInput);

    assert.equal(saved.path, join(appHome, "agents", "code-reviewer.md"));
    assert.equal(saved.created, true);

    const listed = listAssets(contextOf()).agents.find((item) => item.name === "code-reviewer");
    assert.equal(listed?.active, true);
    assert.equal(listed?.scope, "global");
    assert.equal(listed?.editable, true);

    const detail = readAsset(contextOf(), "agent", saved.path);
    assert.equal(detail.label, "代码审查");
    assert.equal(detail.mode, "subagent");
    assert.deepEqual(detail.tools, ["read", "grep"]);
  });

  it("项目档同名压住全局档，被压住的那条带出覆盖者", () => {
    const globalPath = join(appHome, "agents", "shared-name.md");
    saveAsset(contextOf(), {
      kind: "agent",
      name: "shared-name",
      scope: "global",
      description: "全局版",
      body: "全局正文",
    } satisfies AssetsSaveInput);
    mkdirSync(join(project, PROJECT_CONFIG_DIRNAME), { recursive: true });
    const projectSaved = saveAsset(contextOf(), {
      kind: "agent",
      name: "shared-name",
      scope: "project",
      description: "项目版",
      body: "项目正文",
    } satisfies AssetsSaveInput);

    const listed = listAssets(contextOf()).agents.filter((item) => item.name === "shared-name");
    const globalItem = listed.find((item) => item.path === globalPath);
    const projectItem = listed.find((item) => item.path === projectSaved.path);
    assert.equal(projectItem?.active, true);
    assert.equal(globalItem?.active, false);
    assert.equal(globalItem?.overriddenBy, projectSaved.path);
  });

  it("项目档落在 cwd 祖先链上最近的已存在配置目录", () => {
    mkdirSync(join(project, "packages", "ui"), { recursive: true });
    const saved = saveAsset(contextOf(join(project, "packages", "ui")), {
      kind: "command",
      name: "review-diff",
      scope: "project",
      description: "审查当前 diff",
      argumentHint: "[focus]",
      body: "审查这些改动：$1",
    } satisfies AssetsSaveInput);

    assert.equal(saved.path, join(project, PROJECT_CONFIG_DIRNAME, "prompts", "review-diff.md"));
    const detail = readAsset(contextOf(), "command", saved.path);
    assert.equal(detail.argumentHint, "[focus]");
  });

  it("名字不合法与内容不合格分别报 asset_name_invalid / asset_content_invalid", () => {
    assert.throws(
      () =>
        saveAsset(contextOf(), {
          kind: "agent",
          name: "../evil",
          scope: "global",
          description: "x",
          body: "y",
        } satisfies AssetsSaveInput),
      (error) => isCode(error, ERROR_CODES.assetNameInvalid),
    );

    assert.throws(
      () =>
        saveAsset(contextOf(), {
          kind: "skill",
          name: "no-description",
          scope: "global",
          body: "只有正文，没有说明",
        } satisfies AssetsSaveInput),
      (error) => isCode(error, ERROR_CODES.assetContentInvalid),
    );
  });

  it("技能：写入 <name>/SKILL.md，删除时连目录里的其余文件一起删", () => {
    const saved = saveAsset(contextOf(), {
      kind: "skill",
      name: "commit-helper",
      scope: "global",
      description: "按仓库规范写提交信息",
      body: "## 步骤\n\n1. 看 diff\n2. 写提交信息",
    } satisfies AssetsSaveInput);

    assert.equal(saved.path, join(appHome, "skills", "commit-helper", "SKILL.md"));
    writeFileAt(join(appHome, "skills", "commit-helper", "references", "rules.md"), "# 规范\n");

    const detail = readAsset(contextOf(), "skill", saved.path);
    assert.deepEqual(detail.files, ["references/rules.md"]);

    assert.equal(deleteAsset(contextOf(), "skill", saved.path).removed, true);
    assert.equal(
      listAssets(contextOf()).skills.some((item) => item.name === "commit-helper"),
      false,
    );
  });

  it("内置来源只读：可列可读，写删都拒绝", () => {
    const builtinPath = join(appHome, "app", "builtin", "skills", "plugin-create", "SKILL.md");
    writeFileAt(builtinPath, "---\nname: plugin-create\ndescription: 内置技能\n---\n\n正文\n");

    const listed = listAssets(contextOf()).skills.find((item) => item.name === "plugin-create");
    assert.equal(listed?.source, "builtin");
    assert.equal(listed?.editable, false);
    assert.equal(readAsset(contextOf(), "skill", builtinPath).description, "内置技能");

    assert.throws(
      () => deleteAsset(contextOf(), "skill", builtinPath),
      (error) => isCode(error, ERROR_CODES.assetReadOnly),
    );
  });

  it("保留用户自己写的 frontmatter 行（extraLines 原样写回）", () => {
    const path = join(appHome, "skills", "with-extra", "SKILL.md");
    writeFileAt(
      path,
      "---\nname: with-extra\ndescription: 带额外字段\nmetadata:\n  owner: me\n---\n\n正文\n",
    );

    const detail = readAsset(contextOf(), "skill", path);
    assert.deepEqual(detail.extraLines, ["metadata:", "  owner: me"]);

    saveAsset(contextOf(), {
      kind: "skill",
      name: "with-extra",
      scope: "global",
      description: "带额外字段",
      body: "改过的正文",
      extraLines: detail.extraLines,
    } satisfies AssetsSaveInput);

    const content = readFileSync(path, "utf8");
    assert.match(content, /metadata:\n {2}owner: me/);
    assert.match(content, /改过的正文/);
  });

  it("路径不落在资产目录内时定位不到", () => {
    assert.throws(
      () => readAsset(contextOf(), "agent", join(root, "elsewhere", "x.md")),
      (error) => isCode(error, ERROR_CODES.pathNotFound),
    );
  });

  it("$APP_HOME 恰在祖先链上时不被当成项目配置目录", () => {
    // 未绑定项目的会话 cwd 就在 $APP_HOME/workspace/<id> 下，而 $APP_HOME 本身就是 `.<slug>` 形态
    const nested = join(root, "nested");
    const nestedHome = join(nested, PROJECT_CONFIG_DIRNAME);
    const sessionCwd = join(nestedHome, "workspace", "s1");
    mkdirSync(sessionCwd, { recursive: true });

    const saved = saveAsset({ cwd: sessionCwd, appHome: nestedHome, userHome }, {
      kind: "agent",
      name: "scoped-agent",
      scope: "project",
      description: "只读审查",
      body: "正文",
    } satisfies AssetsSaveInput);

    assert.equal(saved.path, join(sessionCwd, PROJECT_CONFIG_DIRNAME, "agents", "scoped-agent.md"));
    assert.notEqual(saved.path, join(nestedHome, "agents", "scoped-agent.md"));
  });

  it("读 / 删不依赖 cwd：按路径形态就能认出项目档", () => {
    const otherProject = join(root, "other-project");
    const path = join(otherProject, PROJECT_CONFIG_DIRNAME, "agents", "from-elsewhere.md");
    writeFileAt(path, "---\nname: from-elsewhere\ndescription: 别处的项目档\n---\n\n正文\n");

    // ctx 的 cwd 指向另一个项目，路径自身仍能定位到它的项目档
    const info = assetPathInfo(contextOf(), "agent", path);
    assert.equal(info?.source, "project");
    assert.equal(info?.scope, "project");
    assert.equal(info?.name, "from-elsewhere");
    assert.equal(deleteAsset(contextOf(), "agent", path).removed, true);
  });

  it("解析失败的文件只进 errors，不影响其余条目", () => {
    writeFileAt(join(appHome, "agents", "broken.md"), "---\nname: broken\n");

    const listed = listAssets(contextOf());
    const broken = listed.errors.find((item) => item.name === "broken");
    assert.equal(broken?.kind, "agent");
    assert.ok(broken?.reason);
    assert.equal(
      listed.agents.some((item) => item.name === "code-reviewer"),
      true,
    );
  });

  it("额外的 frontmatter 行含换行时拒绝写入", () => {
    assert.throws(
      () =>
        saveAsset(contextOf(), {
          kind: "skill",
          name: "injection",
          scope: "global",
          description: "验证",
          body: "正文",
          extraLines: ["owner: me\n---\n注入的内容"],
        } satisfies AssetsSaveInput),
      (error) => isCode(error, ERROR_CODES.assetContentInvalid),
    );
    assert.equal(existsSync(join(appHome, "skills", "injection", "SKILL.md")), false);
  });

  it("与主模式同名的纯子角色进 errors，不算生效项", () => {
    writeFileAt(
      join(appHome, "agents", "build.md"),
      "---\ndescription: 与主模式同名的子角色\nmode: subagent\n---\n\n正文\n",
    );

    const listed = listAssets(contextOf());
    assert.equal(
      listed.agents.some((item) => item.name === "build"),
      false,
    );
    assert.match(listed.errors.find((item) => item.name === "build")?.reason ?? "", /与主模式同名/);

    rmSync(join(appHome, "agents", "build.md"), { force: true });
  });

  it("目标目录位置被同名文件占住时报 path_exists", () => {
    writeFileAt(join(appHome, "skills", "occupied"), "占位文件\n");

    assert.throws(
      () =>
        saveAsset(contextOf(), {
          kind: "skill",
          name: "occupied",
          scope: "global",
          description: "验证",
          body: "正文",
        } satisfies AssetsSaveInput),
      (error) => isCode(error, ERROR_CODES.pathExists),
    );

    rmSync(join(appHome, "skills", "occupied"), { force: true });
  });
});
