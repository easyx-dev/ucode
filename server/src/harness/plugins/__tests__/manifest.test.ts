/** harness/plugins/manifest：清单三档识别、兼容键诊断与组件解析 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { PLUGIN_MANIFEST_DIRNAME } from "../../../constants/dirs";
import { PLUGIN_MANIFEST_MAX_BYTES } from "../../../constants/plugins";
import { findManifestFile, loadPluginManifest, parsePluginManifest } from "../manifest";

const created: string[] = [];

const makePlugin = (manifestDir: string | null = PLUGIN_MANIFEST_DIRNAME): string => {
  const root = mkdtempSync(join(tmpdir(), "plugin-"));
  created.push(root);
  if (manifestDir) mkdirSync(join(root, manifestDir), { recursive: true });
  return root;
};

const writeManifest = (root: string, value: unknown, dir = PLUGIN_MANIFEST_DIRNAME): void => {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "plugin.json"), JSON.stringify(value), "utf8");
};

const writeSkill = (root: string, name: string): void => {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(root, "skills", name, "SKILL.md"), "---\ndescription: d\n---\n正文", "utf8");
};

const groupsOf = (components: Array<{ group: string; name: string }>, group: string): string[] =>
  components.filter((entry) => entry.group === group).map((entry) => entry.name);

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("findManifestFile", () => {
  it("按 本品牌 > zcode > claude 取第一个命中的清单", () => {
    const root = makePlugin();
    writeManifest(root, { name: "a" }, ".claude-plugin");
    writeManifest(root, { name: "b" }, ".zcode-plugin");
    assert.equal(findManifestFile(root), join(root, ".zcode-plugin", "plugin.json"));

    writeManifest(root, { name: "c" });
    assert.equal(findManifestFile(root), join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"));
  });

  it("包内没有清单时返回 null", () => {
    assert.equal(findManifestFile(makePlugin()), null);
  });
});

describe("parsePluginManifest", () => {
  it("JSON 坏、超限与字段类型不符都抛 plugin_manifest_invalid", () => {
    assert.throws(() => parsePluginManifest("{", "/p/plugin.json"), /清单不是合法的 JSON/);
    assert.throws(
      () => parsePluginManifest(JSON.stringify({ name: 1 }), "/p/plugin.json"),
      /清单字段非法/,
    );
    const oversized = JSON.stringify({
      name: "a",
      description: "x".repeat(PLUGIN_MANIFEST_MAX_BYTES),
    });
    assert.throws(() => parsePluginManifest(oversized, "/p/plugin.json"), /超过体积上限/);
  });

  it("字段类型不符按 zod 语义报错，未知键不受影响", () => {
    const manifest = parsePluginManifest(
      JSON.stringify({ name: "a", skills: ["./s"], unknownKey: true }),
      "/p/plugin.json",
    );
    assert.deepEqual(manifest.skills, ["./s"]);
  });
});

describe("loadPluginManifest", () => {
  it("清单缺失时按标准目录布局装载，名字取目录名", () => {
    const root = makePlugin(null);
    writeSkill(root, "review");
    mkdirSync(join(root, "commands", "db"), { recursive: true });
    writeFileSync(join(root, "commands", "db", "migrate.md"), "正文", "utf8");
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "run"), "#!/bin/sh\n", "utf8");

    const load = loadPluginManifest(root);
    assert.equal(load.file, null);
    assert.equal(load.manifest, null);
    assert.equal(load.name, root.split("/").pop());
    assert.equal(load.version, "0.0.0");
    assert.deepEqual(groupsOf(load.components, "skills"), ["review"]);
    // 子目录扁平化：`db/migrate.md` → `db:migrate`
    assert.deepEqual(groupsOf(load.components, "commands"), ["db:migrate"]);
    assert.deepEqual(groupsOf(load.components, "bin"), ["bin"]);
    assert.deepEqual(load.diagnostics, []);
  });

  it("清单里的名字与版本优先，displayName 缺省回落 name", () => {
    const root = makePlugin();
    writeManifest(root, { name: "my-plugin", version: "1.2.3", description: "说明" });
    const load = loadPluginManifest(root);
    assert.equal(load.name, "my-plugin");
    assert.equal(load.version, "1.2.3");
    assert.equal(load.displayName, "my-plugin");
    assert.equal(load.description, "说明");
  });

  it("未知键出 warning、识别但不执行的键出 info，都不影响组件", () => {
    const root = makePlugin();
    writeManifest(root, {
      name: "my-plugin",
      settings: { a: 1 },
      experimental: {},
      dependencies: ["other@local"],
      totallyUnknown: 1,
    });
    writeSkill(root, "review");

    const load = loadPluginManifest(root);
    assert.deepEqual(load.diagnostics.map((item) => item.level).sort(), [
      "info",
      "info",
      "info",
      "warning",
    ]);
    assert.deepEqual(groupsOf(load.components, "skills"), ["review"]);
  });

  it("清单坏了不装载组件，但仍回落目录名并报错", () => {
    const root = makePlugin();
    mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"), "{oops", "utf8");
    writeSkill(root, "review");

    const load = loadPluginManifest(root);
    assert.equal(load.manifest, null);
    assert.deepEqual(load.components, []);
    assert.equal(load.diagnostics[0]?.level, "error");
    assert.match(load.diagnostics[0]?.message ?? "", /不是合法的 JSON/);
  });

  it("name 非法时回落目录名并报错", () => {
    const root = makePlugin();
    writeManifest(root, { name: "My Plugin" });
    const load = loadPluginManifest(root);
    assert.equal(load.name, root.split("/").pop());
    assert.equal(load.diagnostics[0]?.level, "error");
    assert.match(load.diagnostics[0]?.message ?? "", /不合法/);
  });
});

describe("组件路径规则", () => {
  it("不以 ./ 开头、越出插件根都拒绝该组件并诊断，其它组件不受影响", () => {
    const root = makePlugin();
    writeManifest(root, { name: "my-plugin", skills: ["skills"], agents: ["./../outside"] });
    writeSkill(root, "review");

    const load = loadPluginManifest(root);
    assert.deepEqual(groupsOf(load.components, "skills"), ["review"]);
    assert.deepEqual(groupsOf(load.components, "agents"), []);
    const messages = load.diagnostics.map((item) => item.message).join("\n");
    assert.match(messages, /需以 "\.\/" 开头/);
    assert.match(messages, /越出插件根/);
    assert.ok(load.diagnostics.every((item) => item.level === "error"));
  });

  // Windows 上建符号链接需要开发者模式或管理员权限，跳过（实现分支本身与平台无关）
  it("经符号链接逃出插件根时同样拒绝", { skip: process.platform === "win32" }, () => {
    const root = makePlugin();
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    created.push(outside);
    mkdirSync(join(outside, "skills", "evil"), { recursive: true });
    writeFileSync(join(outside, "skills", "evil", "SKILL.md"), "正文", "utf8");
    symlinkSync(outside, join(root, "linked"));

    writeManifest(root, { name: "my-plugin", skills: ["./linked/skills"] });
    const load = loadPluginManifest(root);
    assert.deepEqual(load.components, []);
    assert.match(load.diagnostics[0]?.message ?? "", /符号链接越出插件根/);
  });

  it("组件路径接受 Windows 写法：`.\\` 与前导 `./` 等价", () => {
    const root = makePlugin();
    writeSkill(root, "review");
    writeManifest(root, { name: "my-plugin", skills: [".\\skills\\review"] });

    const load = loadPluginManifest(root);
    assert.deepEqual(groupsOf(load.components, "skills"), ["review"]);
  });

  it("skills 声明直接指向某个技能目录时按单个技能收", () => {
    const root = makePlugin();
    writeSkill(root, "review");
    writeManifest(root, { name: "my-plugin", skills: ["./skills/review"] });

    const load = loadPluginManifest(root);
    assert.deepEqual(groupsOf(load.components, "skills"), ["review"]);
  });

  it("extensions 与默认目录叠加（同名去重）", () => {
    const root = makePlugin();
    mkdirSync(join(root, "extensions"), { recursive: true });
    writeFileSync(join(root, "extensions", "default.ts"), "export {};\n", "utf8");
    mkdirSync(join(root, "extra"), { recursive: true });
    writeFileSync(join(root, "extra", "more.ts"), "export {};\n", "utf8");
    writeManifest(root, { name: "my-plugin", extensions: ["./extensions", "./extra"] });

    const load = loadPluginManifest(root);
    assert.deepEqual(groupsOf(load.components, "extensions").sort(), ["default.ts", "more.ts"]);
  });

  it("hooks 与 MCP 写成对象时按内联定义收，显式声明却找不到文件时报错", () => {
    const root = makePlugin();
    writeManifest(root, {
      name: "my-plugin",
      hooks: { PreToolUse: [] },
      mcpServers: "./missing.json",
    });
    const load = loadPluginManifest(root);
    const hooks = load.components.find((entry) => entry.group === "hooks");
    assert.equal(hooks?.path, null);
    assert.deepEqual(groupsOf(load.components, "mcp"), []);
    assert.match(
      load.diagnostics.map((item) => item.message).join("\n"),
      /配置文件不存在：\.\/missing\.json/,
    );
  });

  it("默认目录缺失不报诊断（插件可以没有 agents / bin / hooks）", () => {
    const root = makePlugin();
    writeManifest(root, { name: "my-plugin" });
    const load = loadPluginManifest(root);
    assert.deepEqual(load.components, []);
    assert.deepEqual(load.diagnostics, []);
  });
});
