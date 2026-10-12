/** services/plugins/marketplace：市场登记 / 移除 / 刷新（本地目录 / url / git），内置市场失败静默 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { PluginsListResponse, ServerControlEvent } from "@ucode/contracts";

import type { SessionEventBus } from "../../../core/event-bus";
import { createMarketplaceService } from "../marketplace";
import type { SourceRunner } from "../sources";
import { PluginStateStore } from "../state";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "marketplace-"));
  created.push(dir);
  return dir;
};

const makeMarket = (manifest: unknown): string => {
  const dir = makeDir();
  writeFileSync(join(dir, "marketplace.json"), JSON.stringify(manifest), "utf8");
  return dir;
};

/** 造一个带各类来源条目的市场目录 */
const makeMarketWithSources = (): string =>
  makeMarket({
    name: "with-sources",
    plugins: [
      { name: "rel", source: "./plugins/rel" },
      { name: "gh", source: { source: "github", repo: "owner/repo" } },
      { name: "npm-pkg", source: { source: "npm", package: "@scope/pkg" } },
      { name: "weird", source: "github:owner/repo" },
    ],
  });

const setup = (
  over: { run?: SourceRunner; pluginsDir?: string; pluginList?: () => PluginsListResponse } = {},
) => {
  const state = new PluginStateStore(join(makeDir(), "plugins.json"));
  state.load();
  const frames: ServerControlEvent[] = [];
  const events = {
    emitControl: (frame: ServerControlEvent) => frames.push(frame),
  } as unknown as SessionEventBus;
  const pluginsDir = over.pluginsDir ?? makeDir();
  return {
    state,
    pluginsDir,
    frames,
    service: createMarketplaceService({
      state,
      events,
      pluginsDir,
      ...(over.pluginList ? { pluginList: over.pluginList } : {}),
      // 默认不给网络与进程：测试要么注入替身，要么走失败分支
      run:
        over.run ??
        (async () => {
          throw new Error("测试里不连网");
        }),
    }),
  };
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("市场登记", () => {
  it("登记本地目录市场：来源回显路径、可列举", () => {
    const { service } = setup();
    const dir = makeMarket({ name: "my-market", plugins: [{ name: "a" }] });

    const created = service.create({
      name: "my-market",
      source: { source: "directory", path: dir },
    });
    assert.equal(created.marketplace.name, "my-market");
    assert.equal(created.marketplace.source, dir);
    assert.equal(created.marketplace.builtin, false);
    assert.equal(created.marketplace.refreshedOk, false);
    assert.equal(created.revision, 1);

    // 内置的 Claude 官方市场随初始状态就在，本地登记追加在它之后
    assert.deepEqual(
      service.list().marketplaces.map((item) => item.name),
      ["claude-plugins-official", "my-market"],
    );
  });

  it("来源目录不存在、重名登记、未登记市场刷新都明确报错", async () => {
    const { service } = setup();
    assert.throws(
      () =>
        service.create({
          name: "gone",
          source: { source: "directory", path: join(makeDir(), "nope") },
        }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "path_not_found",
    );

    const dir = makeMarket({ plugins: [] });
    service.create({ name: "my-market", source: { source: "directory", path: dir } });
    assert.throws(
      () => service.create({ name: "my-market", source: { source: "directory", path: dir } }),
      /市场已登记/,
    );
    await assert.rejects(service.refresh({ name: "nope" }), /市场不存在/);
  });
});

describe("市场刷新", () => {
  it("本地目录市场读出条目数并清掉上一次错误", async () => {
    const { service } = setup();
    const dir = makeMarket({
      name: "my-market",
      plugins: [{ name: "a" }, { name: "b", description: "说明", version: "0.2.0" }, { nope: 1 }],
    });
    service.create({ name: "my-market", source: { source: "directory", path: dir } });

    const refreshed = await service.refresh({ name: "my-market" });
    assert.equal(refreshed.marketplace.refreshedOk, true);
    assert.equal(refreshed.marketplace.pluginCount, 2, "缺 name 的条目被跳过");
    assert.ok(refreshed.marketplace.lastRefreshAt);
    assert.equal(refreshed.marketplace.lastError, undefined);
  });

  it("清单读不出来时用户显式刷新报错，内置市场只记账", async () => {
    const { service } = setup();
    const empty = makeDir();
    service.create({ name: "broken-market", source: { source: "directory", path: empty } });
    await assert.rejects(
      service.refresh({ name: "broken-market" }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "marketplace_invalid",
    );

    // 内置的 claude-plugins-official 是 github 源：克隆失败只记账，不打扰用户
    const builtin = await service.refresh({ name: "claude-plugins-official" });
    assert.equal(builtin.marketplace.refreshedOk, false);
    assert.match(builtin.marketplace.lastError ?? "", /测试里不连网/);
  });
});

describe("市场移除", () => {
  it("移除后下挂插件只失去来源（登记保留），并回报受影响的插件 id", () => {
    const { service, state } = setup();
    const dir = makeMarket({ plugins: [] });
    service.create({ name: "my-market", source: { source: "directory", path: dir } });
    state.set({
      ...state.get(),
      installed: [
        {
          id: "orphan@my-market",
          name: "orphan",
          version: "0.0.0",
          source: { source: "directory", path: dir },
          marketplace: "my-market",
          path: dir,
          enabled: true,
          installedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const removed = service.delete({ name: "my-market" });
    assert.equal(removed.removed, true);
    assert.deepEqual(removed.orphanedPlugins, ["orphan@my-market"]);
    assert.equal(state.get().installed.length, 1, "插件登记保留，由用户决定怎么处理");
  });
});

describe("网络市场", () => {
  const catalogBody = (count: number): Uint8Array =>
    new TextEncoder().encode(
      JSON.stringify({
        name: "remote-market",
        plugins: Array.from({ length: count }, (_, index) => ({ name: `p${index}` })),
      }),
    );

  it("url 市场：条件请求取清单，记 etag 与内容哈希；304 视为未变", async () => {
    const calls: { headers?: Record<string, string> }[] = [];
    const withFetch = setup();
    const market = createMarketplaceService({
      state: withFetch.state,
      events: { emitControl: () => undefined } as unknown as SessionEventBus,
      pluginsDir: withFetch.pluginsDir,
      run: async () => ({ stdout: "" }),
      fetch: async (input) => {
        calls.push({ headers: input.headers });
        return {
          url: new URL(input.url),
          status: calls.length === 1 ? 200 : 304,
          body: catalogBody(2),
          truncated: false,
          contentType: "application/json",
          etag: 'W/"abc"',
          lastModified: null,
        };
      },
    });

    market.create({
      name: "remote-market",
      source: { source: "url", url: "https://example.com/marketplace.json" },
    });
    const first = await market.refresh({ name: "remote-market" });
    assert.equal(first.marketplace.refreshedOk, true);
    assert.equal(first.marketplace.pluginCount, 2);

    const second = await market.refresh({ name: "remote-market" });
    assert.equal(second.marketplace.refreshedOk, true);
    assert.equal(second.marketplace.pluginCount, 2, "304 时保留上次条目数");
    assert.equal(calls[1]?.headers?.["if-none-match"], 'W/"abc"', "第二次带条件请求头");
  });

  it("git 市场：克隆后读仓根的 marketplace.json，并记克隆副本的内容哈希", async () => {
    const pluginsDir = makeDir();
    const run: SourceRunner = async (file, args) => {
      assert.equal(file, "git");
      const target = args[args.length - 1] ?? "";
      // git clone 会自己建目录，替身要把这一步补上
      mkdirSync(target, { recursive: true });
      writeFileSync(
        join(target, "marketplace.json"),
        JSON.stringify({ name: "git-market", plugins: [{ name: "a" }, { name: "b" }] }),
        "utf8",
      );
      return { stdout: "" };
    };
    const { service } = setup({ run, pluginsDir });

    service.create({ name: "git-market", source: { source: "github", repo: "owner/repo" } });
    const refreshed = await service.refresh({ name: "git-market" });

    assert.equal(refreshed.marketplace.refreshedOk, true);
    assert.equal(refreshed.marketplace.pluginCount, 2);
    assert.ok(existsSync(join(pluginsDir, "marketplaces", "git-market", "marketplace.json")));
  });
});

describe("市场内插件列表", () => {
  it("刷新后读缓存条目，并标出哪些已装、哪些可更新", async () => {
    const { service, state } = setup();
    const dir = makeMarket({
      name: "my-market",
      plugins: [
        { name: "installed-one", version: "1.0.0", description: "已装" },
        { name: "fresh-one", version: "2.0.0" },
      ],
    });
    service.create({ name: "my-market", source: { source: "directory", path: dir } });
    await service.refresh({ name: "my-market" });

    state.set({
      ...state.get(),
      installed: [
        {
          id: "installed-one@my-market",
          name: "installed-one",
          version: "0.9.0",
          source: { source: "directory", path: dir },
          marketplace: "my-market",
          path: dir,
          enabled: true,
          installedAt: "2026-01-01T00:00:00.000Z",
          updateAvailable: true,
        },
      ],
    });

    const info = service.info({ name: "my-market" });
    assert.equal(info.marketplace.name, "my-market");
    assert.deepEqual(
      info.plugins.map((item) => [item.name, item.installedId, item.updateAvailable]),
      [
        ["installed-one", "installed-one@my-market", true],
        ["fresh-one", null, false],
      ],
    );
  });

  it("从没刷新过的市场返回空列表，不报错", () => {
    const { service } = setup();
    const dir = makeMarket({ plugins: [] });
    service.create({ name: "empty-market", source: { source: "directory", path: dir } });

    assert.deepEqual(service.info({ name: "empty-market" }).plugins, []);
    assert.throws(() => service.info({ name: "nope" }), /市场不存在/);
  });
});

describe("市场条目的一键安装来源", () => {
  it("本地 / git 市场的相对路径解析成绝对路径，url 市场解析不出来", async () => {
    const { service } = setup();
    const dir = makeMarketWithSources();
    service.create({ name: "my-market", source: { source: "directory", path: dir } });
    await service.refresh({ name: "my-market" });

    const byName = new Map(service.info({ name: "my-market" }).plugins.map((p) => [p.name, p]));
    assert.deepEqual(byName.get("rel")?.source, {
      source: "directory",
      path: join(dir, "plugins/rel"),
    });
    assert.deepEqual(byName.get("gh")?.source, { source: "github", repo: "owner/repo" });
    assert.deepEqual(byName.get("npm-pkg")?.source, { source: "npm", package: "@scope/pkg" });
    assert.equal(byName.get("weird")?.source, null, "带协议的字符串简写不猜");
  });

  it("url 市场里没有可解析的根：相对路径条目能看不能装", async () => {
    const withFetch = setup();
    const market = createMarketplaceService({
      state: withFetch.state,
      events: { emitControl: () => undefined } as unknown as SessionEventBus,
      pluginsDir: withFetch.pluginsDir,
      run: async () => ({ stdout: "" }),
      fetch: async (input) => ({
        url: new URL(input.url),
        status: 200,
        body: new TextEncoder().encode(
          JSON.stringify({
            plugins: [
              { name: "rel", source: "./plugins/rel" },
              { name: "gh", source: { source: "github", repo: "o/r" } },
            ],
          }),
        ),
        truncated: false,
        contentType: "application/json",
        etag: null,
        lastModified: null,
      }),
    });

    market.create({
      name: "remote",
      source: { source: "url", url: "https://example.com/marketplace.json" },
    });
    await market.refresh({ name: "remote" });

    const byName = new Map(market.info({ name: "remote" }).plugins.map((p) => [p.name, p]));
    assert.equal(byName.get("rel")?.source, null);
    assert.deepEqual(byName.get("gh")?.source, { source: "github", repo: "o/r" });
  });
});

describe("变更帧", () => {
  it("市场增删发的 plugins_changed 带真实插件列表：空列表会把界面上的插件卡片清空", async () => {
    const snapshot: PluginsListResponse = {
      plugins: [],
      statePath: "/tmp/plugins.json",
      revision: 7,
      overrides: null,
    };
    const { frames, service } = setup({ pluginList: () => snapshot });

    await service.create({
      name: "demo-market",
      source: { source: "directory", path: makeMarket({ name: "demo-market", plugins: [] }) },
    });

    const frame = frames.at(-1);
    assert.equal(frame?.type, "plugins_changed");
    assert.deepEqual(
      frame?.type === "plugins_changed" ? frame.plugins : null,
      snapshot,
      "帧里的插件列表来自插件服务，而不是凑出来的空壳",
    );
  });

  it("没注入列表提供者时退回空壳（只用于测试与早期装配）", async () => {
    const { frames, service } = setup();
    await service.create({
      name: "demo-market",
      source: { source: "directory", path: makeMarket({ name: "demo-market", plugins: [] }) },
    });
    const frame = frames.at(-1);
    assert.equal(frame?.type === "plugins_changed" ? frame.plugins.plugins.length : -1, 0);
  });
});

describe("条目级诊断", () => {
  it("刷新时跳过的条目原因随缓存带出 info，界面能看到而不是恒空", async () => {
    const dir = makeMarket({
      name: "broken-market",
      plugins: [{ description: "缺 name" }, { name: "ok", version: "1.0.0" }],
    });
    const { service } = setup();
    await service.create({ name: "broken-market", source: { source: "directory", path: dir } });
    await service.refresh({ name: "broken-market" });

    const info = service.info({ name: "broken-market" });
    assert.deepEqual(
      info.plugins.map((item) => item.name),
      ["ok"],
    );
    assert.equal(info.diagnostics.length, 1);
    assert.match(info.diagnostics[0]?.message ?? "", /第 1 个条目缺少 name/);
  });
});
