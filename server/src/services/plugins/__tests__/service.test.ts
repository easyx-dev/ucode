/** services/plugins：安装 / 启停 / 卸载 / 重拉，以及装配期资产目录与变更广播 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

/** 在指定目录里造一个插件包：清单 + 一个技能 + 一个命令 */
const makePluginTree = (root: string, name: string, version = "1.0.0"): string => {
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

/** 造一个独立的临时插件包目录 */
const makePlugin = (name: string, version = "1.0.0"): string =>
  makePluginTree(makeDir(), name, version);

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
  it("按本地目录安装：回执带视图与代次，并广播 plugins_changed", async () => {
    const { service, frames, revisions } = setup();
    const root = makePlugin("my-plugin");

    const result = await service.create({
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

  it("网络来源：git 装进版本化缓存目录，暂存目录不留盘", async () => {
    const { service, pluginsDir } = setup();
    const repo = makeDir("plugin-repo-");
    makePluginTree(join(repo, "pkg"), "git-demo");
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "init");

    const created = await service.create({
      source: { source: "git", url: repo, path: "pkg" },
      scope: "user",
      enabled: true,
    });

    assert.equal(created.plugin.id, "git-demo@local");
    assert.equal(created.plugin.path, join(pluginsDir, "cache", "local", "git-demo", "1.0.0"));
    assert.equal(
      existsSync(join(created.plugin.path, PLUGIN_MANIFEST_DIRNAME, "plugin.json")),
      true,
    );
    assert.equal(
      existsSync(join(pluginsDir, "cache", "local", ".staging")),
      false,
      "暂存目录装完即清",
    );
  });

  it("清单坏了直接失败；重复登记与未登记市场同样拒绝", async () => {
    const { service } = setup();
    const broken = makeDir();
    mkdirSync(join(broken, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(join(broken, PLUGIN_MANIFEST_DIRNAME, "plugin.json"), "{oops", "utf8");
    await assert.rejects(
      service.create({
        source: { source: "directory", path: broken },
        scope: "user",
        enabled: true,
      }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "plugin_manifest_invalid",
    );

    const root = makePlugin("dup");
    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });
    await assert.rejects(
      service.create({
        source: { source: "directory", path: root },
        scope: "user",
        enabled: true,
      }),
      /插件已登记/,
    );
    await assert.rejects(
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

  it("归属内置市场时来源档位是 official", async () => {
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
    const result = await service.create({
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
  it("启停只动开关，卸载移除登记，重拉按源目录更新版本", async () => {
    const { service, state } = setup();
    const root = makePlugin("my-plugin", "1.0.0");
    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });

    const disabled = service.update({ id: "my-plugin@local", enabled: false });
    assert.equal(disabled.plugin.enabled, false);
    assert.equal(disabled.revision, 2);

    writeFileSync(
      join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
      JSON.stringify({ name: "my-plugin", version: "2.0.0" }),
      "utf8",
    );
    assert.equal((await service.refresh({ id: "my-plugin@local" })).plugin.version, "2.0.0");

    const removed = service.delete({ id: "my-plugin@local", purge: false });
    assert.equal(removed.removed, true);
    assert.equal(removed.purged, false);
    assert.deepEqual(state.get().installed, []);
    assert.throws(() => service.update({ id: "my-plugin@local", enabled: true }), /插件不存在/);
  });

  it("purge 只删插件根内的内容与插件数据目录，不动用户自己的源目录", async () => {
    const pluginsDir = makeDir("plugin-root-");
    const { service } = setup({ pluginsDir });
    const source = makePlugin("src-plugin");
    await service.create({
      source: { source: "directory", path: source },
      scope: "user",
      enabled: true,
    });

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
  it("只收启用插件的技能 / 命令目录，去重后给出", async () => {
    const { service } = setup();
    const root = makePlugin("my-plugin");
    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });

    assert.deepEqual(service.commandAssets(), {
      skills: [join(realpathSync(root), "skills")],
      prompts: [join(realpathSync(root), "commands")],
    });

    service.update({ id: "my-plugin@local", enabled: false });
    assert.deepEqual(service.commandAssets(), { skills: [], prompts: [] });
  });
});

describe("执行类组件的来源门控", () => {
  const makePluginWithExecutables = (name: string): string => {
    const root = makeDir();
    mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(
      join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
      JSON.stringify({ name, version: "1.0.0" }),
      "utf8",
    );
    mkdirSync(join(root, "extensions"), { recursive: true });
    writeFileSync(join(root, "extensions", "main.ts"), "export {};\n", "utf8");
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "run"), "#!/bin/sh\n", "utf8");
    return root;
  };

  const createInMarket = async (
    service: ReturnType<typeof setup>["service"],
    state: ReturnType<typeof setup>["state"],
    root: string,
    marketplace: string,
    builtin: boolean,
  ): Promise<void> => {
    state.set({
      ...state.get(),
      marketplaces: [
        ...state.get().marketplaces,
        {
          name: marketplace,
          source: { source: "github", repo: "owner/repo" },
          builtin,
          refreshedOk: false,
          pluginCount: 0,
        },
      ],
    });
    await service.create({
      source: { source: "directory", path: root },
      marketplace,
      scope: "user",
      enabled: true,
    });
  };

  it("本地与官方来源注入扩展与 bin；第三方市场只出诊断", async () => {
    const { service, state } = setup();
    const local = makePluginWithExecutables("local-plugin");
    await service.create({
      source: { source: "directory", path: local },
      scope: "user",
      enabled: true,
    });

    const official = makePluginWithExecutables("official-plugin");
    await createInMarket(service, state, official, "our-official", true);

    const thirdParty = makePluginWithExecutables("market-plugin");
    await createInMarket(service, state, thirdParty, "third-party", false);

    const real = (path: string): string => join(realpathSync(path), "");
    assert.deepEqual(
      service.extensionPaths().sort(),
      [real(join(local, "extensions")), real(join(official, "extensions"))].sort(),
    );
    assert.deepEqual(
      service.binDirs().sort(),
      [real(join(local, "bin")), real(join(official, "bin"))].sort(),
    );

    const blocked = service.registry().plugins.find((item) => item.name === "market-plugin");
    assert.deepEqual(blocked?.blocked, ["extensions", "bin"], "第三方市场被标为不注入");
  });

  it("插件停用后它的扩展与 bin 也不再注入", async () => {
    const { service } = setup();
    const root = makePluginWithExecutables("local-plugin");
    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });
    assert.equal(service.extensionPaths().length, 1);

    service.update({ id: "local-plugin@local", enabled: false });
    assert.deepEqual(service.extensionPaths(), []);
    assert.deepEqual(service.binDirs(), []);
  });
});

describe("插件子角色", () => {
  it("启用插件的角色进 agentProfiles，停用后退出", async () => {
    const { service } = setup();
    const root = makeDir();
    mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(
      join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
      JSON.stringify({ name: "agent-plugin" }),
      "utf8",
    );
    mkdirSync(join(root, "agents"), { recursive: true });
    writeFileSync(
      join(root, "agents", "reviewer.md"),
      "---\ndescription: 审查改动\ntools: Read, Grep\n---\n\n正文\n",
      "utf8",
    );

    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });
    assert.deepEqual(
      service.agentProfiles().map((agent) => [agent.slug, agent.tools]),
      [["agent-plugin-reviewer", ["read", "grep"]]],
    );

    service.update({ id: "agent-plugin@local", enabled: false });
    assert.deepEqual(service.agentProfiles(), []);
  });
});

describe("hooks 的来源门控与解析", () => {
  const makePluginWithHooks = (name: string, hooks: unknown): string => {
    const root = makeDir();
    mkdirSync(join(root, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
    writeFileSync(
      join(root, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
      JSON.stringify({ name, version: "1.0.0" }),
      "utf8",
    );
    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(join(root, "hooks", "hooks.json"), JSON.stringify(hooks), "utf8");
    return root;
  };

  const bindHooks = {
    hooks: {
      PreToolUse: [{ matcher: "^bash$", hooks: [{ type: "command", command: "guard.sh" }] }],
      PermissionRequest: [{ hooks: [{ command: "never.sh" }] }],
    },
  };

  it("本地来源的 hooks 解析成绑定并标出被忽略的事件；第三方市场的不挂载", async () => {
    const { service, state } = setup();
    const local = makePluginWithHooks("local-hooks", bindHooks);
    await service.create({
      source: { source: "directory", path: local },
      scope: "user",
      enabled: true,
    });

    const hooks = service.hooks();
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0]?.event, "PreToolUse");
    assert.equal(hooks[0]?.matcher, "^bash$");
    assert.equal(hooks[0]?.pluginRoot, join(realpathSync(local), ""));
    const local_descriptor = service.registry().plugins.find((item) => item.name === "local-hooks");
    assert.match(
      local_descriptor?.diagnostics.map((item) => item.message).join("\n") ?? "",
      /事件 PermissionRequest 本轮不实现/,
    );

    const thirdParty = makePluginWithHooks("market-hooks", bindHooks);
    state.set({
      ...state.get(),
      marketplaces: [
        ...state.get().marketplaces,
        {
          name: "third-party",
          source: { source: "github", repo: "owner/repo" },
          builtin: false,
          refreshedOk: false,
          pluginCount: 0,
        },
      ],
    });
    await service.create({
      source: { source: "directory", path: thirdParty },
      marketplace: "third-party",
      scope: "user",
      enabled: true,
    });

    assert.equal(service.hooks().length, 1, "第三方市场的 hook 不进挂载表");
    assert.deepEqual(
      service.registry().plugins.find((item) => item.name === "market-hooks")?.blocked,
      ["hooks"],
    );
  });

  it("停用插件后它的 hook 也退出挂载表", async () => {
    const { service } = setup();
    const root = makePluginWithHooks("local-hooks", bindHooks);
    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });
    assert.equal(service.hooks().length, 1);

    service.update({ id: "local-hooks@local", enabled: false });
    assert.deepEqual(service.hooks(), []);
  });
});

describe("来源已变检测", () => {
  it("安装时记目录内容哈希；目录改动后 checkUpdates 标出新版本，重拉后清掉", async () => {
    const { service, state } = setup();
    const root = makePlugin("my-plugin");
    await service.create({
      source: { source: "directory", path: root },
      scope: "user",
      enabled: true,
    });

    const record = state.get().installed[0];
    assert.match(record?.integrity ?? "", /^[0-9a-f]{64}$/, "安装即记录内容哈希");
    assert.equal(record?.updateAvailable, false);
    assert.ok(record?.checkedAt);

    assert.equal(service.checkUpdates(), 0, "内容没变就不算新版本");
    assert.equal(service.list().plugins[0]?.updateAvailable, false);

    // 改一处内容：下次检查应标出「来源已变」
    writeFileSync(
      join(root, "skills", "review", "SKILL.md"),
      "---\ndescription: 改过\n---\n正文",
      "utf8",
    );
    assert.equal(service.checkUpdates(), 1);
    const view = service.list().plugins[0];
    assert.equal(view?.updateAvailable, true);
    assert.ok(view?.checkedAt);

    // 重拉 = 接受当前内容
    await service.refresh({ id: "my-plugin@local" });
    assert.equal(service.list().plugins[0]?.updateAvailable, false);
    assert.equal(service.checkUpdates(), 0);
  });

  it("非目录来源不参与这次判定（网络来源待包拉取落地）", () => {
    const { service, state } = setup();
    state.set({
      ...state.get(),
      installed: [
        {
          id: "remote@local",
          name: "remote",
          version: "1.0.0",
          source: { source: "npm", package: "some-plugin" },
          path: "/tmp/remote",
          scope: "user",
          enabled: true,
          installedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    assert.equal(service.checkUpdates(), 0);
    assert.equal(service.list().plugins[0]?.updateAvailable, false);
  });
});
