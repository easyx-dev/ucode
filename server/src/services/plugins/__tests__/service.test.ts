/** services/plugins：安装 / 启停 / 卸载 / 重拉，以及装配期资产目录与变更广播 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { ServerControlEvent } from "@ucode/contracts";

import { PLUGIN_MANIFEST_DIRNAME } from "../../../constants/dirs";
import type { SessionEventBus } from "../../../core/event-bus";
import { createPluginService } from "..";
import { PluginStateStore } from "../state";

const created: string[] = [];

const makeDir = (prefix = "plugin-svc-"): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

/** 造一个插件包：清单 + 一个技能 + 一个命令 */
const makePlugin = (name: string, version = "1.0.0"): string => {
  const root = makeDir();
  mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
  writeFileSync(
    join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
    JSON.stringify({ name, version, description: "说明" }),
    "utf8",
  );
  mkdirSync(join(root, "skills", "review"), { recursive: true });
  writeFileSync(join(root, "skills", "review", "SKILL.md"), "正文", "utf8");
  mkdirSync(join(root, "commands", "db"), { recursive: true });
  writeFileSync(join(root, "commands", "db", "migrate.md"), "正文", "utf8");
  return root;
};

const setup = (input: { pluginsDir?: string } = {}) => {
  const statePath = join(makeDir("plugin-state-"), "plugins.json");
  const pluginsDir = input.pluginsDir ?? makeDir("plugin-root-");
  const state = new PluginStateStore(statePath);
  state.load();
  const frames: ServerControlEvent[] = [];
  const events = {
    emitControl: (frame: ServerControlEvent) => frames.push(frame),
  } as unknown as SessionEventBus;
  const revisions: number[] = [];
  const service = createPluginService({
    state,
    events,
    pluginsDir,
    onRegistryChange: (revision) => revisions.push(revision),
  });
  return { state, statePath, pluginsDir, service, frames, revisions };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("安装与登记", () => {
  it("按本地目录安装：回执带视图与代次，并广播 plugins_changed", () => {
    const { service, frames, revisions } = setup();
    const root = makePlugin("my-plugin");

    const result = service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });
    assert.equal(result.plugin.id, "my-plugin@local");
    assert.equal(result.plugin.source, "local");
    assert.equal(result.plugin.version, "1.0.0");
    assert.equal(result.revision, 1);
    assert.deepEqual(result.plugin.components, {
      skills: 1,
      commands: 1,
      agents: 0,
      hooks: 0,
      mcp: 0,
      bin: 0,
      extensions: 0,
    });
    assert.deepEqual(revisions, [1]);
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.type, "plugins_changed");
    assert.equal(frames[0]?.type === "plugins_changed" ? frames[0].plugins.plugins.length : -1, 1);
  });

  it("未实现的来源明确拒绝，不做静默降级", () => {
    const { service } = setup();
    assert.throws(
      () =>
        service.create({ source: { source: "npm", package: "pkg" }, scope: "user", enabled: true }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "plugin_source_invalid",
    );
  });

  it("清单坏了直接失败；重复登记与未登记市场同样拒绝", () => {
    const { service } = setup();
    const broken = makeDir();
    mkdirSync(join(broken, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(join(broken, PLUGIN_MANIFEST_DIRNAME, "plugin.json"), "{oops", "utf8");
    assert.throws(
      () =>
        service.create({
          source: { source: "directory", path: broken },
          scope: "user",
          enabled: true,
        }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "plugin_manifest_invalid",
    );

    const root = makePlugin("dup");
    service.create({ source: { source: "directory", path: root }, scope: "user", enabled: true });
    assert.throws(
      () =>
        service.create({
          source: { source: "directory", path: root },
          scope: "user",
          enabled: true,
        }),
      /插件已登记/,
    );
    assert.throws(
      () =>
        service.create({
          source: { source: "directory", path: root },
          marketplace: "nope",
          scope: "user",
          enabled: true,
        }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "marketplace_invalid",
    );
  });

  it("归属内置市场时来源档位是 official", () => {
    const { service, state } = setup();
    state.set({
      ...state.get(),
      marketplaces: [
        ...state.get().marketplaces,
        {
          name: "my-official",
          source: { source: "directory", path: makeDir() },
          builtin: true,
          refreshedOk: false,
          pluginCount: 0,
        },
      ],
    });
    const root = makePlugin("official-plugin");
    const result = service.create({
      source: { source: "directory", path: root },
      marketplace: "my-official",
      scope: "user",
      enabled: true,
    });
    assert.equal(result.plugin.id, "official-plugin@my-official");
    assert.equal(result.plugin.source, "official");
  });
});

describe("启停 / 卸载 / 重拉", () => {
  it("启停只动开关，卸载移除登记，重拉按源目录更新版本", () => {
    const { service, state } = setup();
    const root = makePlugin("my-plugin", "1.0.0");
    service.create({ source: { source: "directory", path: root }, scope: "user", enabled: true });

    const disabled = service.update({ id: "my-plugin@local", enabled: false });
    assert.equal(disabled.plugin.enabled, false);
    assert.equal(disabled.revision, 2);

    writeFileSync(
      join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
      JSON.stringify({ name: "my-plugin", version: "2.0.0" }),
      "utf8",
    );
    assert.equal(service.refresh({ id: "my-plugin@local" }).plugin.version, "2.0.0");

    const removed = service.delete({ id: "my-plugin@local", purge: false });
    assert.equal(removed.removed, true);
    assert.equal(removed.purged, false);
    assert.deepEqual(state.get().installed, []);
    assert.throws(() => service.update({ id: "my-plugin@local", enabled: true }), /插件不存在/);
  });

  it("purge 只删插件根内的内容与插件数据目录，不动用户自己的源目录", () => {
    const pluginsDir = makeDir("plugin-root-");
    const { service } = setup({ pluginsDir });
    const source = makePlugin("src-plugin");
    service.create({ source: { source: "directory", path: source }, scope: "user", enabled: true });

    // 数据目录预先造出来，验证 purge 会清它
    const dataDir = join(pluginsDir, "data", "src-plugin-local");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "state.json"), "{}", "utf8");

    const removed = service.delete({ id: "src-plugin@local", purge: true });
    assert.equal(removed.purged, false, "directory 源不复制内容，purge 不该删源目录");
    assert.equal(existsSync(source), true);
    assert.equal(existsSync(dataDir), false);
  });
});

describe("装配期资产目录", () => {
  it("只收启用插件的技能 / 命令目录，去重后给出", () => {
    const { service } = setup();
    const root = makePlugin("my-plugin");
    service.create({ source: { source: "directory", path: root }, scope: "user", enabled: true });

    assert.deepEqual(service.commandAssets(), {
      skills: [join(realpathSync(root), "skills")],
      prompts: [join(realpathSync(root), "commands")],
    });

    service.update({ id: "my-plugin@local", enabled: false });
    assert.deepEqual(service.commandAssets(), { skills: [], prompts: [] });
  });
});
