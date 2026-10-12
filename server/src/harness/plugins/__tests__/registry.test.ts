/** harness/plugins/registry：来源门控、只认登记表的发现与视图映射 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { PLUGIN_MANIFEST_DIRNAME } from "../../../constants/dirs";
import { buildPluginRegistry } from "../registry";
import {
  type InstalledPluginRecord,
  LOCAL_MARKETPLACE_NAME,
  type PluginMarketplaceRecord,
  pluginSwitchOf,
  toPluginId,
} from "../state";
import { toPluginComponentCounts, toPluginView } from "../view";

const created: string[] = [];

const makeRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-root-"));
  created.push(dir);
  return dir;
};

/** 造一个带 skill / hook / extension / bin 的插件包 */
const makePluginDir = (name: string): string => {
  const root = makeRoot();
  mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
  writeFileSync(
    join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0", description: "说明" }),
    "utf8",
  );
  mkdirSync(join(root, "skills", "review"), { recursive: true });
  writeFileSync(join(root, "skills", "review", "SKILL.md"), "正文", "utf8");
  mkdirSync(join(root, "hooks"), { recursive: true });
  writeFileSync(join(root, "hooks", "hooks.json"), "{}", "utf8");
  mkdirSync(join(root, "extensions"), { recursive: true });
  writeFileSync(join(root, "extensions", "main.ts"), "export {};\n", "utf8");
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "bin", "run"), "#!/bin/sh\n", "utf8");
  return root;
};

const marketplace = (
  name: string,
  builtin: boolean,
  trust: PluginMarketplaceRecord["trust"] = builtin ? "official" : "market",
): PluginMarketplaceRecord => ({
  name,
  source: { source: "github", repo: "owner/repo" },
  builtin,
  trust,
  refreshedOk: false,
  pluginCount: 0,
});

const installed = (input: {
  name: string;
  path: string;
  marketplace?: string;
}): InstalledPluginRecord => ({
  id: toPluginId(input.name, input.marketplace),
  name: input.name,
  version: "0.0.0",
  source: { source: "directory", path: input.path },
  ...(input.marketplace ? { marketplace: input.marketplace } : {}),
  path: input.path,
  enabled: true,
  installedAt: "2026-01-01T00:00:00.000Z",
});

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildPluginRegistry", () => {
  it("发现只认登记表：插件根里的目录没登记就不加载", () => {
    makePluginDir("sneaky");
    const registry = buildPluginRegistry({
      revision: 3,
      marketplaces: [marketplace("my-market", false)],
      installed: [],
    });
    assert.deepEqual(registry.plugins, []);
    assert.equal(registry.revision, 3);
  });

  it("按来源分档：内置市场 official、直接登记 local、其余市场 market", () => {
    const official = installed({
      name: "a",
      path: makePluginDir("a"),
      marketplace: "builtin-market",
    });
    const localByField = installed({
      name: "b",
      path: makePluginDir("b"),
      marketplace: LOCAL_MARKETPLACE_NAME,
    });
    const localByAbsence = installed({ name: "d", path: makePluginDir("d") });
    const market = installed({ name: "c", path: makePluginDir("c"), marketplace: "third-party" });
    const registry = buildPluginRegistry({
      revision: 1,
      marketplaces: [marketplace("builtin-market", true), marketplace("third-party", false)],
      installed: [official, localByField, localByAbsence, market],
    });

    assert.deepEqual(
      registry.plugins.map((item) => item.source),
      ["official", "local", "local", "market"],
    );
    // 本地登记用 `@local` 这个合成市场位，不该被当成「市场已移除」
    assert.deepEqual(registry.diagnostics, []);
  });

  it("第三方市场的执行类组件标为不注入，权威来源与资源型组件不受影响", () => {
    const plugins = [
      installed({ name: "a", path: makePluginDir("a"), marketplace: "builtin-market" }),
      installed({ name: "b", path: makePluginDir("b"), marketplace: LOCAL_MARKETPLACE_NAME }),
      installed({ name: "c", path: makePluginDir("c"), marketplace: "third-party" }),
    ];
    const registry = buildPluginRegistry({
      revision: 1,
      marketplaces: [marketplace("builtin-market", true), marketplace("third-party", false)],
      installed: plugins,
    });

    const [official, local, market] = registry.plugins;
    assert.deepEqual(official?.blocked, []);
    assert.deepEqual(local?.blocked, []);
    assert.deepEqual(market?.blocked, ["hooks", "extensions", "bin"]);
    // 资源型组件照常解析：第三方插件的技能仍然可用
    assert.deepEqual(
      market?.components.filter((entry) => entry.group === "skills").map((entry) => entry.name),
      ["review"],
    );
  });

  it("只有资源型组件的第三方插件没有可拦的东西", () => {
    const root = makeRoot();
    mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(
      join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
      JSON.stringify({ name: "d" }),
      "utf8",
    );
    mkdirSync(join(root, "skills", "review"), { recursive: true });
    writeFileSync(join(root, "skills", "review", "SKILL.md"), "正文", "utf8");

    const registry = buildPluginRegistry({
      revision: 1,
      marketplaces: [marketplace("third-party", false)],
      installed: [installed({ name: "d", path: root, marketplace: "third-party" })],
    });
    assert.deepEqual(registry.plugins[0]?.blocked, []);
  });

  it("安装目录不存在时该插件报错，其它插件照常", () => {
    const registry = buildPluginRegistry({
      revision: 1,
      marketplaces: [],
      installed: [
        installed({ name: "gone", path: join(makeRoot(), "not-created") }),
        installed({ name: "ok", path: makePluginDir("ok") }),
      ],
    });

    assert.match(registry.plugins[0]?.diagnostics[0]?.message ?? "", /安装目录不存在/);
    assert.deepEqual(registry.plugins[0]?.components, []);
    assert.equal(registry.plugins[1]?.diagnostics.length, 0);
  });

  it("登记表里的重复 id 只保留第一条并出诊断", () => {
    const path = makePluginDir("dup");
    const registry = buildPluginRegistry({
      revision: 1,
      marketplaces: [],
      installed: [
        installed({ name: "dup", path }),
        installed({ name: "dup", path: makePluginDir("dup") }),
      ],
    });

    assert.equal(registry.plugins.length, 1);
    assert.match(registry.diagnostics[0]?.message ?? "", /重复的插件 id/);
  });

  it("归属市场已移除时按第三方市场处理并出警告", () => {
    const registry = buildPluginRegistry({
      revision: 1,
      marketplaces: [],
      installed: [
        installed({ name: "orphan", path: makePluginDir("orphan"), marketplace: "gone" }),
      ],
    });

    assert.equal(registry.plugins[0]?.source, "market");
    assert.deepEqual(registry.plugins[0]?.blocked, ["hooks", "extensions", "bin"]);
    assert.match(registry.diagnostics[0]?.message ?? "", /已不在登记表里/);
  });
});

describe("视图映射", () => {
  it("组件计数覆盖七个文件型分组，视图带上安装路径与门控结论", () => {
    const path = makePluginDir("my-plugin");
    const registry = buildPluginRegistry({
      revision: 7,
      marketplaces: [marketplace("third-party", false)],
      installed: [installed({ name: "my-plugin", path, marketplace: "third-party" })],
    });
    const descriptor = registry.plugins[0];
    assert.ok(descriptor);

    assert.deepEqual(toPluginComponentCounts(descriptor), {
      skills: 1,
      commands: 0,
      agents: 0,
      hooks: 1,
      mcp: 0,
      bin: 1,
      extensions: 1,
    });

    const view = toPluginView(descriptor, pluginSwitchOf(descriptor, null));
    assert.equal(view.id, "my-plugin@third-party");
    assert.equal(view.enabledBy, "user", "没有覆盖文件时开关来自用户登记表");
    assert.equal(view.displayName, "my-plugin");
    assert.equal(view.version, "1.0.0");
    assert.equal(view.path, path);
    assert.equal(view.source, "market");
    assert.deepEqual(view.blockedComponents, ["hooks", "extensions", "bin"]);
    // 装配期注入的资产目录与逐条组件分开：loader 收的是目录
    assert.deepEqual(descriptor.assets, {
      skills: [join(path, "skills")],
      prompts: [],
      extensions: [join(path, "extensions")],
    });
  });
});
