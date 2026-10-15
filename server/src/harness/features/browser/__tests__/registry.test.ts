/**
 * 注册表单测：实例按 profile 共享、上限、引用释放与「本会话没开过页面」的报错。
 * 这些用例不会真的启动浏览器（实例只在 open 时才起进程）。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { BROWSER_MAX_PROFILES } from "../../../../constants/browser";
import { ensureProfileDir, profilesRoot } from "../profiles";
import { createBrowserRegistry } from "../registry";

const acquire = (
  registry: ReturnType<typeof createBrowserRegistry>,
  sessionId: string,
  profile = "default",
): void => {
  registry.acquire({ sessionId, profile, mode: "isolated" });
};

describe("createBrowserRegistry", () => {
  it("同一个 profile 只开一份实例，多个会话共享", () => {
    const registry = createBrowserRegistry();
    acquire(registry, "s1");
    acquire(registry, "s2");
    assert.equal(registry.stats().length, 1);
    assert.deepEqual(registry.stats()[0]?.holders.sort(), ["s1", "s2"]);
  });

  it("不同 profile 各自一份实例", () => {
    const registry = createBrowserRegistry();
    acquire(registry, "s1", "a");
    acquire(registry, "s2", "b");
    assert.deepEqual(
      registry
        .stats()
        .map((item) => item.profile)
        .sort(),
      ["a", "b"],
    );
  });

  it("超过实例上限即失败，并说明怎么办", () => {
    const registry = createBrowserRegistry({ maxInstances: 1 });
    acquire(registry, "s1", "a");
    assert.throws(
      () => acquire(registry, "s2", "b"),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "browser_limit");
        assert.match(error.message, /browser_close/);
        return true;
      },
    );
  });

  it("没开过页面的会话取实例时报「还没打开」", () => {
    const registry = createBrowserRegistry();
    assert.throws(
      () => registry.current("s1"),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "browser_not_open");
        return true;
      },
    );
  });

  it("释放后实例按 closeWhenUnused 决定是否立即关掉", () => {
    const registry = createBrowserRegistry();
    acquire(registry, "s1");
    const kept = registry.release("s1");
    assert.deepEqual(kept, { closed: false, remainingHolders: 0 });
    assert.equal(registry.stats().length, 1, "留给空闲回收");

    acquire(registry, "s2");
    const closed = registry.release("s2", { closeWhenUnused: true });
    assert.equal(closed.closed, true);
    assert.equal(registry.stats().length, 0);
  });

  it("多个引用者时最后一个离开才关", () => {
    const registry = createBrowserRegistry();
    acquire(registry, "s1");
    acquire(registry, "s2");
    assert.deepEqual(registry.release("s1", { closeWhenUnused: true }), {
      closed: false,
      remainingHolders: 1,
    });
    assert.equal(registry.release("s2", { closeWhenUnused: true }).closed, true);
  });

  it("会话离池只放引用，实例仍在（别的会话可能还在用）", () => {
    const registry = createBrowserRegistry();
    acquire(registry, "s1");
    acquire(registry, "s2");
    registry.release("s1");
    assert.equal(registry.stats()[0]?.holders.length, 1);
    assert.equal(registry.stats()[0]?.holders[0], "s2");
  });

  it("disposeAll 清空全部实例", () => {
    const registry = createBrowserRegistry();
    acquire(registry, "s1", "a");
    acquire(registry, "s2", "b");
    registry.disposeAll();
    assert.equal(registry.stats().length, 0);
  });
});

const homes: string[] = [];
const fakeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), "browser-registry-"));
  homes.push(home);
  return home;
};

after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

describe("持久化 profile", () => {
  it("给出名字即建目录（0700）并把数据目录交给实例", () => {
    if (process.platform === "win32") return;
    const home = fakeHome();
    const registry = createBrowserRegistry({ appHome: home });
    registry.acquire({ sessionId: "s1", profile: "work", mode: "isolated", persist: true });

    const dir = join(profilesRoot(home), "work");
    assert.equal(existsSync(dir), true);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(registry.stats()[0]?.userDataDir, dir);
  });

  it("不持久化时没有数据目录（临时实例）", () => {
    const registry = createBrowserRegistry({ appHome: fakeHome() });
    registry.acquire({ sessionId: "s1", profile: "default", mode: "isolated" });
    assert.equal(registry.stats()[0]?.userDataDir, null);
  });

  it("名字不合法直接拒绝，不会建出目录外的路径", () => {
    const home = fakeHome();
    const registry = createBrowserRegistry({ appHome: home });
    assert.throws(
      () =>
        registry.acquire({
          sessionId: "s1",
          profile: "../escape",
          mode: "isolated",
          persist: true,
        }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "browser_profile_invalid");
        return true;
      },
    );
    assert.equal(existsSync(join(home, "escape")), false);
  });

  it("同一 profile 不能被两种数据目录同时打开", () => {
    const registry = createBrowserRegistry({ appHome: fakeHome() });
    registry.acquire({ sessionId: "s1", profile: "work", mode: "isolated" });
    assert.throws(
      () => registry.acquire({ sessionId: "s2", profile: "work", mode: "isolated", persist: true }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "browser_profile_in_use");
        return true;
      },
    );
  });

  it("持久化 profile 份数达上限即拒绝新建", () => {
    const home = fakeHome();
    for (let index = 0; index < BROWSER_MAX_PROFILES; index += 1)
      ensureProfileDir(`p${index}`, home);
    const registry = createBrowserRegistry({ appHome: home });
    assert.throws(
      () =>
        registry.acquire({ sessionId: "s1", profile: "one-more", mode: "isolated", persist: true }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "browser_limit");
        return true;
      },
    );
  });

  it("isInUse 反映引用状态（设置页删除前的保护）", () => {
    const registry = createBrowserRegistry({ appHome: fakeHome() });
    registry.acquire({ sessionId: "s1", profile: "work", mode: "isolated", persist: true });
    assert.equal(registry.isInUse("work"), true);
    registry.release("s1", { closeWhenUnused: true });
    assert.equal(registry.isInUse("work"), false);
  });
});
