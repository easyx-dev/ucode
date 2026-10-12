/** services/plugins/state：plugins.json 的建立、限权、代次推进与纯逻辑 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_PLUGIN_MARKETPLACES,
  emptyPluginState,
  LOCAL_MARKETPLACE_NAME,
  parsePluginId,
  pluginSourceOf,
  toPluginId,
  withProjectOverrides,
} from "../../../harness/plugins/state";
import { PluginStateStore } from "..";

const created: string[] = [];

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
          scope: "user",
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

  it("来源分档：内置市场 official、无市场 local、其余 market", () => {
    const marketplaces = [
      {
        name: "builtin-market",
        source: { source: "github", repo: "owner/repo" } as const,
        builtin: true,
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

  it("项目级覆盖只改启用状态，且项目级默认不启用", () => {
    const state = emptyPluginState();
    const next = withProjectOverrides(
      {
        ...state,
        installed: [
          {
            id: "user-plugin@local",
            name: "user-plugin",
            version: "0.0.0",
            source: { source: "directory", path: "/p" },
            path: "/p",
            scope: "user",
            enabled: true,
            installedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "proj-plugin@local",
            name: "proj-plugin",
            version: "0.0.0",
            source: { source: "directory", path: "/q" },
            path: "/q",
            scope: "project",
            enabled: true,
            installedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "proj-on@local",
            name: "proj-on",
            version: "0.0.0",
            source: { source: "directory", path: "/r" },
            path: "/r",
            scope: "project",
            enabled: false,
            installedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      { enabled: ["proj-on@local"] },
    );

    assert.deepEqual(
      next.installed.map((item) => [item.id, item.enabled]),
      [
        ["user-plugin@local", true],
        ["proj-plugin@local", false],
        ["proj-on@local", true],
      ],
    );
  });
});
