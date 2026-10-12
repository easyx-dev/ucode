/** services/plugins/state：plugins.json 的建立、限权、代次推进与纯逻辑 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  PLUGIN_PROJECT_OVERRIDES_FILENAME,
  PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME,
  PROJECT_CONFIG_DIRNAME,
} from "../../../constants/dirs";
import {
  DEFAULT_PLUGIN_MARKETPLACES,
  emptyPluginState,
  LOCAL_MARKETPLACE_NAME,
  loadProjectPluginOverrides,
  OFFICIAL_PLUGIN_MARKETPLACE_ID,
  parsePluginId,
  pluginSourceOf,
  pluginSwitchOf,
  toPluginId,
} from "../../../harness/plugins/state";
import { PluginStateStore } from "..";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-cwd-"));
  created.push(dir);
  return dir;
};

const makeStatePath = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-state-"));
  created.push(dir);
  return join(dir, "plugins.json");
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("PluginStateStore", () => {
  it("文件缺失时建立初始状态：内置市场 + 0600 限权", () => {
    const path = makeStatePath();
    const store = new PluginStateStore(path);

    const state = store.load();
    assert.deepEqual(
      state.marketplaces.map((item) => item.name),
      DEFAULT_PLUGIN_MARKETPLACES.map((item) => item.name),
    );
    assert.deepEqual(state.installed, []);
    assert.equal(state.revision, 0);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("坏状态文件直接报 invalid_config，不静默丢弃", () => {
    const path = makeStatePath();
    writeFileSync(path, "{oops", "utf8");
    const store = new PluginStateStore(path);

    assert.throws(
      () => store.load(),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "invalid_config",
    );
  });

  it("变更入口经 update 推进 revision，并落盘", () => {
    const path = makeStatePath();
    const store = new PluginStateStore(path);
    store.load();

    const next = store.update((state) => ({
      ...state,
      installed: [
        {
          id: toPluginId("my-plugin"),
          name: "my-plugin",
          version: "0.0.0",
          source: { source: "directory", path: "/tmp/my-plugin" },
          path: "/tmp/my-plugin",
          enabled: true,
          installedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    }));

    assert.equal(next.revision, 1);
    assert.equal(new PluginStateStore(path).load().revision, 1);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it("按 id 取登记记录，缺失时抛 plugin_not_found", () => {
    const store = new PluginStateStore(makeStatePath());
    store.load();

    assert.throws(
      () => store.requirePlugin("nope@local"),
      (error: unknown) =>
        error instanceof Error &&
        (error as { code?: string }).code === "plugin_not_found" &&
        (error as { status?: number }).status === 404,
    );
  });
});

describe("纯逻辑", () => {
  it("插件 id 的组装与拆解", () => {
    assert.equal(toPluginId("hello", "my-market"), "hello@my-market");
    assert.equal(toPluginId("hello"), `hello@${LOCAL_MARKETPLACE_NAME}`);
    assert.deepEqual(parsePluginId("hello@my-market"), {
      name: "hello",
      marketplace: "my-market",
    });
    assert.equal(parsePluginId("hello"), null);
    assert.equal(parsePluginId("@x"), null);
    assert.equal(parsePluginId("x@"), null);
  });

  it("来源分档：声明 official 的市场 official、无市场 local、其余 market", () => {
    const marketplaces = [
      {
        name: "builtin-market",
        source: { source: "github", repo: "owner/repo" } as const,
        builtin: true,
        trust: "official" as const,
        refreshedOk: false,
        pluginCount: 0,
      },
    ];
    const base = {
      id: "a@local",
      name: "a",
      version: "0.0.0",
      source: { source: "directory", path: "/p" } as const,
      path: "/p",
      scope: "user" as const,
      enabled: true,
      installedAt: "2026-01-01T00:00:00.000Z",
    };

    assert.equal(pluginSourceOf({ ...base }, marketplaces), "local");
    assert.equal(
      pluginSourceOf({ ...base, marketplace: "builtin-market" }, marketplaces),
      "official",
    );
    assert.equal(pluginSourceOf({ ...base, marketplace: "third-party" }, marketplaces), "market");
  });

  it("老状态文件缺了后来新增的内置市场：加载时补回并落盘", () => {
    const path = makeStatePath();
    // 模拟上一个版本写下的状态：只有 Claude 那一个内置市场
    writeFileSync(
      path,
      JSON.stringify({
        revision: 3,
        marketplaces: [
          {
            name: "claude-plugins-official",
            source: { source: "github", repo: "anthropics/claude-plugins-official" },
            builtin: true,
            refreshedOk: false,
            pluginCount: 0,
          },
        ],
        installed: [],
      }),
      "utf8",
    );

    const state = new PluginStateStore(path).load();
    assert.deepEqual(
      state.marketplaces.map((item) => item.name),
      ["claude-plugins-official", OFFICIAL_PLUGIN_MARKETPLACE_ID],
      "缺的内置市场补回来",
    );
    assert.equal(state.revision, 3, "只是多一条市场记录，不动代次");
    assert.deepEqual(
      JSON.parse(readFileSync(path, "utf8")).marketplaces.map(
        (item: { name: string }) => item.name,
      ),
      ["claude-plugins-official", OFFICIAL_PLUGIN_MARKETPLACE_ID],
      "补进来的结果立刻落盘，别每次启动都重算",
    );
  });

  it("删掉过的内置市场不会被加载时的并入加回来", () => {
    const path = makeStatePath();
    const store = new PluginStateStore(path);
    const initial = store.load();
    store.set({
      ...initial,
      marketplaces: initial.marketplaces.filter(
        (item) => item.name !== OFFICIAL_PLUGIN_MARKETPLACE_ID,
      ),
      removedMarketplaces: [OFFICIAL_PLUGIN_MARKETPLACE_ID],
    });

    const reloaded = new PluginStateStore(path).load();
    assert.deepEqual(
      reloaded.marketplaces.map((item) => item.name),
      ["claude-plugins-official"],
    );
  });

  it("覆盖按 local > project > user 生效，只翻已登记插件的开关", () => {
    const cwd = makeDir();
    const dir = join(cwd, PROJECT_CONFIG_DIRNAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, PLUGIN_PROJECT_OVERRIDES_FILENAME),
      JSON.stringify({ enabledPlugins: { "a@local": false, "b@local": true } }),
      "utf8",
    );
    writeFileSync(
      join(dir, PLUGIN_PROJECT_OVERRIDES_LOCAL_FILENAME),
      JSON.stringify({ enabledPlugins: { "a@local": true } }),
      "utf8",
    );

    const overrides = loadProjectPluginOverrides(cwd);
    assert.deepEqual(overrides.diagnostics, []);
    assert.equal(pluginSwitchOf({ id: "a@local", enabled: false }, overrides).enabled, true);
    assert.equal(pluginSwitchOf({ id: "a@local", enabled: false }, overrides).enabledBy, "local");
    assert.equal(pluginSwitchOf({ id: "b@local", enabled: false }, overrides).enabled, true);
    assert.equal(pluginSwitchOf({ id: "b@local", enabled: false }, overrides).enabledBy, "project");
    // 覆盖里没提到的 id 保持登记表里的值；项目文件不能凭空启用一个没装的插件
    assert.deepEqual(pluginSwitchOf({ id: "c@local", enabled: true }, overrides), {
      enabled: true,
      enabledBy: "user",
    });
    const bogus = pluginSwitchOf({ id: "never-installed@local", enabled: false }, overrides);
    assert.equal(bogus.enabledBy, "user");
  });

  it("没有覆盖文件时一律按用户级；坏 JSON 只记诊断", () => {
    const cwd = makeDir();
    const bare = loadProjectPluginOverrides(cwd);
    assert.deepEqual(bare.diagnostics, []);
    assert.equal(pluginSwitchOf({ id: "a@local", enabled: true }, bare).enabledBy, "user");

    mkdirSync(join(cwd, PROJECT_CONFIG_DIRNAME), { recursive: true });
    writeFileSync(
      join(cwd, PROJECT_CONFIG_DIRNAME, PLUGIN_PROJECT_OVERRIDES_FILENAME),
      "{oops",
      "utf8",
    );
    const broken = loadProjectPluginOverrides(cwd);
    assert.equal(broken.diagnostics.length, 1);
    assert.match(broken.diagnostics[0] ?? "", /读不出来/);
    assert.equal(
      pluginSwitchOf({ id: "a@local", enabled: true }, broken).enabled,
      true,
      "坏文件按不存在处理",
    );
  });
});
