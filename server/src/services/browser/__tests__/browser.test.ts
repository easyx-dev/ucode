/**
 * 浏览器数据面的单测：列举（占用 / 使用中标记 / 上限）与删除（使用中跳过、名字不合法跳过、清空）。
 * 跑在临时 `$APP_HOME` 上，不起真浏览器（实例只在 open 时才拉进程）。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { ensureProfileDir, profilesRoot } from "../../../harness/features/browser/profiles";
import { createBrowserService } from "../index";

const homes: string[] = [];

const fakeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "browser-service-"));
  homes.push(home);
  return home;
};

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe("createBrowserService", () => {
  it("列举给出占用、根目录与上限", () => {
    const home = fakeHome();
    const dir = ensureProfileDir("work", home);
    writeFileSync(join(dir, "Cookies"), Buffer.alloc(512));
    const service = createBrowserService({ appHome: home });

    const result = service.list();
    assert.equal(result.root, profilesRoot(home));
    assert.equal(result.limits.maxProfiles, 10);
    assert.equal(result.profiles.length, 1);
    assert.equal(result.profiles[0]?.name, "work");
    assert.equal(result.profiles[0]?.bytes, 512);
    assert.equal(result.profiles[0]?.exact, true);
    assert.equal(result.profiles[0]?.inUse, false);
  });

  it("使用中的 profile 被标出来（界面据此禁用删除）", () => {
    const home = fakeHome();
    const service = createBrowserService({ appHome: home });
    service.hooks.acquire({ sessionId: "s1", profile: "work", mode: "isolated", persist: true });

    const profile = service.list().profiles.find((item) => item.name === "work");
    assert.equal(profile?.inUse, true);
  });

  it("删除使用中的 profile 会被跳过并说明原因", () => {
    const home = fakeHome();
    const service = createBrowserService({ appHome: home });
    service.hooks.acquire({ sessionId: "s1", profile: "work", mode: "isolated", persist: true });
    ensureProfileDir("play", home);

    const result = service.delete({ names: ["work", "play", "ghost", "../bad"] });
    assert.deepEqual(result.deleted, ["play"]);
    assert.deepEqual(result.missing, ["ghost"]);
    assert.deepEqual(result.skipped, [
      { name: "work", reason: "正在使用中" },
      { name: "../bad", reason: "名字不合法" },
    ]);
  });

  it("传全集即清空", () => {
    const home = fakeHome();
    const service = createBrowserService({ appHome: home });
    ensureProfileDir("a", home);
    ensureProfileDir("b", home);
    const names = service.list().profiles.map((item) => item.name);
    assert.deepEqual(service.delete({ names }).deleted.sort(), ["a", "b"]);
    assert.deepEqual(service.list().profiles, []);
  });

  it("释放引用后就可以删了（说明该 profile 不再被握着）", () => {
    const home = fakeHome();
    const service = createBrowserService({ appHome: home });
    service.hooks.acquire({ sessionId: "s1", profile: "work", mode: "isolated", persist: true });
    service.hooks.release("s1", { closeWhenUnused: true });
    assert.deepEqual(service.delete({ names: ["work"] }).deleted, ["work"]);
  });
});
