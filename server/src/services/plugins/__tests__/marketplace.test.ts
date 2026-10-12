/** services/plugins/marketplace：市场登记 / 移除 / 刷新（本地目录市场），内置市场失败静默 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import type { ServerControlEvent } from "@ucode/contracts";

import type { SessionEventBus } from "../../../core/event-bus";
import { createMarketplaceService } from "../marketplace";
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

const setup = () => {
  const state = new PluginStateStore(join(makeDir(), "plugins.json"));
  state.load();
  const frames: ServerControlEvent[] = [];
  const events = {
    emitControl: (frame: ServerControlEvent) => frames.push(frame),
  } as unknown as SessionEventBus;
  return { state, service: createMarketplaceService({ state, events }), frames };
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

  it("来源目录不存在、重名登记、未登记市场刷新都明确报错", () => {
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
    assert.throws(() => service.refresh({ name: "nope" }), /市场不存在/);
  });
});

describe("市场刷新", () => {
  it("本地目录市场读出条目数并清掉上一次错误", () => {
    const { service } = setup();
    const dir = makeMarket({
      name: "my-market",
      plugins: [{ name: "a" }, { name: "b", description: "说明", version: "0.2.0" }, { nope: 1 }],
    });
    service.create({ name: "my-market", source: { source: "directory", path: dir } });

    const refreshed = service.refresh({ name: "my-market" });
    assert.equal(refreshed.marketplace.refreshedOk, true);
    assert.equal(refreshed.marketplace.pluginCount, 2, "缺 name 的条目被跳过");
    assert.ok(refreshed.marketplace.lastRefreshAt);
    assert.equal(refreshed.marketplace.lastError, undefined);
  });

  it("清单读不出来时用户显式刷新报错，内置市场只记账", () => {
    const { service } = setup();
    const empty = makeDir();
    service.create({ name: "broken-market", source: { source: "directory", path: empty } });
    assert.throws(
      () => service.refresh({ name: "broken-market" }),
      (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "marketplace_invalid",
    );

    // 内置的 claude-plugins-official 是 github 源，网络底座落地前刷新一律静默降级
    const builtin = service.refresh({ name: "claude-plugins-official" });
    assert.equal(builtin.marketplace.refreshedOk, false);
    assert.match(builtin.marketplace.lastError ?? "", /来源尚未支持/);
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
          scope: "user",
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
