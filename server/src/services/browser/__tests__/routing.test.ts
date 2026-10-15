/**
 * 服务门面的路由：受管实例与桌面端页面之间怎么选、释放时引用有没有漏。
 *
 * 这一层出错的代价很隐蔽（引用漏了要攒到实例上限才发作、选错了则是「以为在驱动 A，实际在驱动 B」），
 * 所以用真服务 + 假桌面端通道把几条路径钉住。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appHomeDirname } from "@ucode/brand/values";
import type { DesktopCdpCommand } from "@ucode/contracts";

import type { DesktopChannel } from "../desktop";
import { createBrowserService } from "../index";

/** 临时数据目录：名字从品牌派生（硬编码品牌名会被 pnpm check 拦下） */
const homeDir = (name: string): string => `/tmp/${appHomeDirname}-routing-${name}`;

const channel = (): DesktopChannel & { frames: DesktopCdpCommand[] } => {
  const frames: DesktopCdpCommand[] = [];
  return { frames, close: () => undefined, send: (frame) => frames.push(frame) };
};

const tab = (id: string, webContentsId: number | null, active = true) => ({
  id,
  title: `页面 ${id}`,
  url: `https://example.com/${id}`,
  webContentsId,
  active,
});

const serviceOn = (appHome: string) => {
  const service = createBrowserService({ appHome });
  const desktopChannel = channel();
  service.desktop.attach(desktopChannel);
  service.desktop.setTabs(desktopChannel, [tab("t1", 11)]);
  return { service, desktopChannel };
};

const acquireInput = (sessionId: string, managedRequested?: boolean) => ({
  sessionId,
  profile: "work",
  persist: true,
  mode: "isolated" as const,
  ...(managedRequested === undefined ? {} : { managedRequested }),
});

describe("浏览器服务的路由", () => {
  it("没显式要受管实例时驱动桌面端那一个", () => {
    const { service } = serviceOn(homeDir("none"));
    const session = service.hooks.acquire(acquireInput("s1"));
    assert.equal(session.mode, "desktop");
  });

  it("显式要受管实例时把它建起来，并且不再留着桌面端那个会话", () => {
    const { service } = serviceOn(homeDir("managed"));
    const desktopSession = service.hooks.acquire(acquireInput("s1"));
    assert.equal(desktopSession.mode, "desktop");

    const managed = service.hooks.acquire(acquireInput("s1", true));
    assert.equal(managed.mode, "isolated");
    // 两者不会共存：后面几次调用都该走受管实例，而不是缓存里的桌面端会话
    assert.equal(service.hooks.current("s1"), managed);
  });

  it("释放时两边的账都要结：受管实例的引用不能漏（漏了 profile 永远显示使用中）", async () => {
    const { service } = serviceOn(homeDir("release"));
    service.hooks.acquire(acquireInput("s1"));
    service.hooks.acquire(acquireInput("s1", true));
    assert.equal(service.stats().length, 1);
    assert.deepEqual(service.stats()[0]?.holders, ["s1"]);

    service.hooks.release("s1", { closeWhenUnused: true });
    await new Promise((done) => setTimeout(done, 0));

    assert.deepEqual(service.stats(), [], "引用归零后实例应当关掉并从表里消失");
  });

  it("guest 重建（webContentsId 变了）时重建会话，旧编号立刻失效", async () => {
    const { service, desktopChannel } = serviceOn(homeDir("rebuild"));
    const first = service.hooks.acquire(acquireInput("s1"));
    assert.equal(first.mode, "desktop");
    assert.equal(service.hooks.current("s1"), first, "同一标签且 guest 未变时复用");

    // 面板在 guest 挂上/重建后会重新上报：id 不变、webContentsId 变了
    service.desktop.setTabs(desktopChannel, [tab("t1", 22)]);
    const second = service.hooks.current("s1");
    assert.notEqual(second, first, "guest 换了就不能复用旧会话（旧句柄已销毁）");
    assert.equal(second.mode, "desktop");
  });

  it("桌面端没有标签时报的是「去开一个标签」，不会偷偷换成受管实例", () => {
    const { service, desktopChannel } = serviceOn(homeDir("no-tab"));
    service.hooks.acquire(acquireInput("s1"));
    service.desktop.setTabs(desktopChannel, []);

    assert.throws(
      () => service.hooks.current("s1"),
      (error: unknown) => error instanceof Error && /桌面端没有开着浏览器标签/.test(error.message),
    );
  });
});
