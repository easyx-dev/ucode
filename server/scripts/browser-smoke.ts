/**
 * 浏览器工具集的端到端冒烟：本地起一个静态页，跑通
 * open → snapshot → fill → click → 遮挡失败 → 截图 → 导航失效 → close。
 *
 * 需要本机有浏览器（走自动探测，可用 `CHROME_PATH` 覆盖），因此**不进 `pnpm test`**——
 * CI 上没有浏览器。用法：`pnpm -F @ucode/server browser:smoke`。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserError } from "../src/harness/features/browser/errors";
import { ensureProfileDir } from "../src/harness/features/browser/profiles";
import { type BrowserSession, createBrowserSession } from "../src/harness/features/browser/session";

const PAGE = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>浏览器冒烟页</title></head>
  <body>
    <h1>冒烟页</h1>
    <!-- 取噪会丢掉这个无名容器；它被点时会写下「点了噪声」，用来验证取噪后编号没错位 -->
    <div id="noise" role="generic" style="width:80px;height:20px;background:#eee"
      onclick="document.getElementById('result').textContent='点了噪声'"></div>
    <label for="name">名字</label>
    <input id="name" placeholder="请输入名字" />
    <button id="greet">问候</button>
    <button id="cover">盖住</button>
    <button id="cookie">种 cookie</button>
    <a href="/other">下一页</a>
    <p id="result" role="status">（未问候）</p>
    <p id="cookie-state" role="status">cookie:无</p>
    <div id="mask" style="position:fixed;inset:0;display:none;background:rgba(0,0,0,.4)">
      <button id="dismiss">关闭遮罩</button>
    </div>
    <script>
      const result = document.getElementById("result");
      document.getElementById("greet").addEventListener("click", () => {
        result.textContent = "你好，" + (document.getElementById("name").value || "陌生人");
      });
      document.getElementById("cover").addEventListener("click", () => {
        document.getElementById("mask").style.display = "block";
      });
      document.getElementById("dismiss").addEventListener("click", () => {
        document.getElementById("mask").style.display = "none";
      });
      const cookieState = document.getElementById("cookie-state");
      const showCookie = () => {
        cookieState.textContent = "cookie:" + (document.cookie || "无");
      };
      document.getElementById("cookie").addEventListener("click", () => {
        // 带有效期：会话 cookie 不进磁盘，测「跨会话保留」必须用持久 cookie
        document.cookie = "smoke=1; path=/; max-age=3600";
        showCookie();
      });
      showCookie();
    </script>
  </body>
</html>`;

/** 从快照文本里找某个名字的元素 ref */
const refOfName = (snapshot: string, name: string): string => {
  const line = snapshot.split("\n").find((item) => item.includes(`"${name}"`));
  assert.ok(line, `快照里没找到「${name}」：\n${snapshot}`);
  const ref = line.split(" ")[0] ?? "";
  assert.ok(ref?.startsWith("@e"), `没解析出编号：${line}`);
  return ref;
};

const main = async (): Promise<void> => {
  const server = createServer((_request, response) => {
    const body = PAGE.replace("</body>", "<p>别的页面</p></body>");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;

  const session = createBrowserSession({ profile: "smoke", mode: "isolated" });
  try {
    const opened = await session.open({ url });
    assert.equal(opened.title, "浏览器冒烟页");
    console.log(`✓ open：${opened.url}（${opened.title}）`);

    const first = await session.snapshot({});
    assert.match(first.text, /button "问候"/);
    // 标签关联优先于 placeholder（可访问名口径），所以名字取的是「名字」
    assert.match(first.text, /textbox "名字"/);
    assert.match(first.text, /status "（未问候）"/);
    console.log(`✓ snapshot：${first.count} 个元素，编号形如 ${refOfName(first.text, "问候")}`);

    const nameRef = refOfName(first.text, "名字");
    const greetRef = refOfName(first.text, "问候");
    await session.act({ action: "fill", ref: nameRef, text: "UCode" });
    const clicked = await session.act({ action: "click", ref: greetRef });
    assert.equal(clicked.navigated, false);
    console.log(`✓ act：fill + click → ${clicked.summary}`);

    const after = await session.snapshot({});
    assert.match(after.text, /status "你好，UCode"/, "点击后结果文本应出现在快照里");
    console.log("✓ 交互结果通过 role=status 读回：你好，UCode");

    // 遮挡：盖住以后中心点命中的是遮罩，必须立刻失败并指出被谁挡住（源方案 §6.3）
    const coverRef = refOfName(after.text, "盖住");
    await session.act({ action: "click", ref: coverRef });
    const blockedStart = Date.now();
    const failure = await session
      .act({ action: "click", ref: greetRef })
      .then(() => null)
      .catch((error: BrowserError) => error);
    assert.ok(failure, "被遮挡时点击应当失败");
    assert.equal(failure.code, "element_obstructed");
    assert.match(failure.message, /挡住/);
    console.log(`✓ 遮挡检测：${Date.now() - blockedStart}ms 内失败——${failure.message}`);

    const shot = await session.screenshot({ fullPage: true });
    assert.ok(shot.data.length > 1_000, "截图应返回实际图像数据");
    console.log(`✓ screenshot：${(shot.data.length / 1024).toFixed(0)}KB（base64）`);

    // 遮罩里自己的按钮不受遮挡影响：关掉它才能继续（真实站点的 cookie 弹层就是这个形状）
    const covered = await session.snapshot({});
    const dismissRef = refOfName(covered.text, "关闭遮罩");
    await session.act({ action: "click", ref: dismissRef });
    console.log("✓ 遮挡层内的元素仍可操作：已关掉遮罩");

    // 导航后旧编号必须失效，强制重新快照（源方案 §6.4）
    const reloaded = await session.snapshot({});
    const linkRef = refOfName(reloaded.text, "下一页");
    const jumped = await session.act({ action: "click", ref: linkRef });
    assert.equal(jumped.navigated, true);
    const stale = await session
      .act({ action: "click", ref: greetRef })
      .then(() => null)
      .catch((error: BrowserError) => error);
    assert.ok(stale, "导航后旧编号应当失效");
    assert.equal(stale.staleRefs, true);
    console.log(`✓ 导航失效：${stale.code}（staleRefs=${stale.staleRefs}）`);

    // 取噪：丢掉无名容器后，编号必须仍指着对应的元素（曾经会整体错位，点到别的元素上）
    await session.open({ url });
    const compact = await session.snapshot({ compact: true });
    assert.doesNotMatch(compact.text, /generic ""/, "取噪应丢掉无名的通用容器");
    await session.act({ action: "click", ref: refOfName(compact.text, "问候") });
    const afterCompact = await session.snapshot({});
    assert.match(
      afterCompact.text,
      /status "你好，陌生人"/,
      "取噪后点「问候」应落在问候按钮上，而不是被取噪的那个容器上",
    );
    console.log("✓ 取噪（compact）：丢掉无名容器后编号仍指着正确元素");
  } finally {
    await session.close();
  }

  // 数据面：临时 profile 关掉即删、持久化 profile 重开仍在（两者只差一个 userDataDir）
  const smokeHome = mkdtempSync(join(tmpdir(), "browser-smoke-"));
  /** 种一次 cookie 再重开：返回重开后看到的状态行 */
  const reopenCookieState = async (
    session: BrowserSession,
    expectAfterOpen: string,
  ): Promise<string> => {
    await session.open({ url });
    const before = await session.snapshot({});
    assert.match(
      before.text,
      new RegExp(`status "${expectAfterOpen}"`),
      `打开时应是 ${expectAfterOpen}`,
    );
    await session.act({ action: "click", ref: refOfName(before.text, "种 cookie") });
    const after = await session.snapshot({});
    assert.match(after.text, /status "cookie:smoke=1"/, "点了之后 cookie 应写入");
    await session.close();
    return after.text;
  };

  try {
    await reopenCookieState(
      createBrowserSession({ profile: "smoke-temp", mode: "isolated" }),
      "cookie:无",
    );
    const tempAgain = createBrowserSession({ profile: "smoke-temp", mode: "isolated" });
    await tempAgain.open({ url });
    const tempText = (await tempAgain.snapshot({})).text;
    await tempAgain.close();
    assert.match(tempText, /status "cookie:无"/, "临时目录关掉即删，重开不该带着上次的 cookie");
    console.log("✓ 临时 profile：关掉即删，重开看不到上次的 cookie");

    const profileDir = ensureProfileDir("smoke-persist", smokeHome);
    await reopenCookieState(
      createBrowserSession({ profile: "smoke-persist", mode: "isolated", userDataDir: profileDir }),
      "cookie:无",
    );
    const kept = createBrowserSession({
      profile: "smoke-persist",
      mode: "isolated",
      userDataDir: profileDir,
    });
    await kept.open({ url });
    const keptText = (await kept.snapshot({})).text;
    await kept.close();
    assert.match(keptText, /status "cookie:smoke=1"/, "持久化 profile 重开后登录态应仍在");
    const mode = statSync(profileDir).mode & 0o777;
    if (process.platform !== "win32") assert.equal(mode, 0o700, "profile 目录权限应为 0700");
    console.log(`✓ 持久化 profile：重开后 cookie 仍在，目录权限 0${mode.toString(8)}`);
  } finally {
    rmSync(smokeHome, { recursive: true, force: true });
    server.close();
  }

  assert.equal(session.isOpen(), false);
  console.log("✓ close：实例已关闭");
  console.log("\n浏览器工具集冒烟通过");
};

await main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
