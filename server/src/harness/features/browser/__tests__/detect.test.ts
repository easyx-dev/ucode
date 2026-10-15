/**
 * 浏览器探测的单测：注入假的文件系统与环境，验证 6 级优先级与失败文案。
 * 不碰真实浏览器，也不读真实磁盘。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type BrowserProbe, detectBrowser, detectFailureMessage } from "../detect";

const probeWith = (hits: string[], dirs: string[] = []): Partial<BrowserProbe> => ({
  platform: "darwin",
  env: { PATH: "/usr/local/bin:/usr/bin" },
  home: "/home/tester",
  exists: (path) => hits.includes(path),
  isDir: (path) => dirs.includes(path),
  // 假磁盘：目录项既可能来自 dirs（目录），也可能来自 hits（文件），两者都算这一层的条目
  list: (dir) =>
    [...dirs, ...hits]
      .filter((entry) => entry.startsWith(`${dir}/`))
      .map((entry) => entry.slice(dir.length + 1)),
});

describe("detectBrowser", () => {
  it("显式覆盖优先于一切", () => {
    const result = detectBrowser({
      override: "/custom/chrome",
      probe: probeWith([
        "/custom/chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ]),
    });
    assert.equal(result.browser?.path, "/custom/chrome");
    assert.equal(result.browser?.origin, "override");
  });

  it("环境变量次之", () => {
    const result = detectBrowser({
      probe: {
        ...probeWith(["/opt/edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]),
        env: { CHROME_PATH: undefined, EDGE_PATH: "/opt/edge", PATH: "" },
      },
    });
    assert.equal(result.browser?.path, "/opt/edge");
    assert.equal(result.browser?.origin, "env");
    assert.equal(result.browser?.name, "edge");
  });

  it("标准安装路径先于 PATH 与缓存", () => {
    const result = detectBrowser({
      probe: probeWith([
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
      ]),
    });
    assert.equal(result.browser?.origin, "standard");
    assert.equal(result.browser?.name, "chrome");
  });

  it("PATH 查找能命中", () => {
    const result = detectBrowser({ probe: probeWith(["/usr/bin/chromium"]) });
    assert.equal(result.browser?.path, "/usr/bin/chromium");
    assert.equal(result.browser?.origin, "path");
  });

  it("Playwright 缓存里按名字找可执行文件", () => {
    const root = "/home/tester/Library/Caches/ms-playwright";
    const result = detectBrowser({
      probe: probeWith(
        [`${root}/chromium-1234/chrome-mac/Chromium.app/Contents/MacOS/Chromium`],
        [
          `${root}/chromium-1234/chrome-mac/Chromium.app/Contents/MacOS`,
          root,
          `${root}/chromium-1234`,
          `${root}/chromium-1234/chrome-mac`,
          `${root}/chromium-1234/chrome-mac/Chromium.app`,
          `${root}/chromium-1234/chrome-mac/Chromium.app/Contents`,
          `${root}/chromium-1234/chrome-mac/Chromium.app/Contents/MacOS`,
        ],
      ),
    });
    assert.equal(result.browser?.origin, "playwright-cache");
    assert.match(result.browser?.path ?? "", /chromium-1234/);
  });

  it("全都找不到时返回 null，并列出试过的路径", () => {
    const result = detectBrowser({ probe: probeWith([]) });
    assert.equal(result.browser, null);
    assert.ok(result.tried.length > 0);
    const message = detectFailureMessage(result);
    assert.match(message, /找不到可用的浏览器/);
    assert.match(message, /试过：/);
  });
});
