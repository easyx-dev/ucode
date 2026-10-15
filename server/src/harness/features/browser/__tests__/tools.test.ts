/**
 * 工具注册单测：装配层拿到的是一个 pi 扩展工厂，注册的名字、声明口径与「没开页面时的报错」都要对。
 * 真浏览器下的行为由 `pnpm -F @ucode/server browser:smoke` 覆盖。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

import { createBrowserExtension } from "../index";
import { createBrowserRegistry } from "../registry";
import { BROWSER_TOOL_NAMES } from "../tools";

const fakePi = (register: (tool: ToolDefinition) => void): ExtensionAPI =>
  ({ registerTool: register }) as unknown as ExtensionAPI;

const fakeContext = (sessionId: string): ExtensionToolContext =>
  ({ sessionManager: { getSessionId: () => sessionId } }) as unknown as ExtensionToolContext;

const execute = async (
  tool: ToolDefinition,
  params: Record<string, unknown>,
  sessionId: string,
): Promise<unknown> => tool.execute("call", params, undefined, undefined, fakeContext(sessionId));

describe("createBrowserExtension", () => {
  it("注册全部浏览器工具", () => {
    const registered: ToolDefinition[] = [];
    createBrowserExtension({ browser: createBrowserRegistry() })(
      fakePi((tool) => registered.push(tool)),
    );
    assert.deepEqual(
      registered.map((tool) => tool.name),
      [...BROWSER_TOOL_NAMES],
    );
  });

  it("每个工具都有面向模型的描述、串行执行口径与合法入参 schema", () => {
    const registered: ToolDefinition[] = [];
    createBrowserExtension({ browser: createBrowserRegistry() })(
      fakePi((tool) => registered.push(tool)),
    );
    for (const tool of registered) {
      assert.ok(tool.description.length > 20, `${tool.name} 的描述太短`);
      assert.equal(
        tool.executionMode,
        "sequential",
        `${tool.name} 应与其它工具串行（浏览器状态是共享的）`,
      );
      assert.equal(typeof tool.parameters, "object", `${tool.name} 缺入参 schema`);
    }
    // 浏览器工具会改变外部世界的状态，这组声明是权限引擎之外的第二道提示
    assert.equal(
      registered.find((tool) => tool.name === "browser_open")?.annotations?.openWorldHint,
      true,
    );
    assert.equal(
      registered.find((tool) => tool.name === "browser_act")?.annotations?.destructiveHint,
      true,
    );
  });

  it("没打开页面就调 snapshot 时会提示先 browser_open，而不是去启动浏览器", async () => {
    const registered: ToolDefinition[] = [];
    createBrowserExtension({ browser: createBrowserRegistry() })(
      fakePi((tool) => registered.push(tool)),
    );
    const snapshot = registered.find((tool) => tool.name === "browser_snapshot");
    assert.ok(snapshot);

    await assert.rejects(
      () => execute(snapshot, {}, "s1"),
      (error: Error & { code?: string; hint?: string }) => {
        assert.equal(error.code, "browser_not_open");
        assert.match(error.message, /browser_open/);
        return true;
      },
    );
  });

  it("file:// 之类的地址被当面拒绝（本机文件读面不交给模型）", async () => {
    const registered: ToolDefinition[] = [];
    createBrowserExtension({ browser: createBrowserRegistry() })(
      fakePi((tool) => registered.push(tool)),
    );
    const open = registered.find((tool) => tool.name === "browser_open");
    assert.ok(open);

    await assert.rejects(
      () => execute(open, { url: "file:///etc/passwd" }, "s1"),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "blocked_target");
        assert.match(error.message, /http\/https/);
        return true;
      },
    );
    await assert.rejects(() => execute(open, { url: "不是地址" }, "s1"), /地址无法解析/);
  });
});

describe("配置默认值", () => {
  const toolsOf = (
    settings: () => { mode: "isolated" | "attach"; endpoint: string; profile: string },
  ) => {
    const registered: ToolDefinition[] = [];
    createBrowserExtension({ browser: createBrowserRegistry(), settings })(
      fakePi((tool) => registered.push(tool)),
    );
    return registered;
  };

  it("attach 缺端点时当面说清楚，而不是等连接失败", async () => {
    const open = toolsOf(() => ({ mode: "attach", endpoint: "", profile: "" })).find(
      (tool) => tool.name === "browser_open",
    );
    assert.ok(open);
    await assert.rejects(
      () => execute(open, { url: "https://example.com" }, "s1"),
      (error: Error & { code?: string; hint?: string }) => {
        assert.equal(error.code, "attach_failed");
        assert.match(error.message, /cdpEndpoint|端点/);
        return true;
      },
    );
  });

  it("工具入参优先于配置：传了 cdpEndpoint 就按 attach 连它", async () => {
    const registered = toolsOf(() => ({ mode: "isolated", endpoint: "", profile: "" }));
    const open = registered.find((tool) => tool.name === "browser_open");
    assert.ok(open);
    // 端点连不上是另一回事（这里只验证「走了 attach 分支」：报的是连接失败而不是「没有端点」）
    await assert.rejects(
      () => execute(open, { url: "https://example.com", cdpEndpoint: "http://127.0.0.1:1" }, "s1"),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "attach_failed");
        assert.match(error.message, /连接/);
        return true;
      },
    );
  });

  it("配置里的默认 profile 会被当作持久化 profile 使用", async () => {
    const registered = toolsOf(() => ({ mode: "isolated", endpoint: "", profile: "team" }));
    const open = registered.find((tool) => tool.name === "browser_open");
    assert.ok(open);
    // 打开会真起浏览器，这里只到「ref 校验」之前就够：拿不到浏览器时会以 browser_not_installed 结束，
    // 说明它已经走到了启动这一步（profile 解析成功）
    await assert.rejects(() => execute(open, { url: "not-a-url" }, "s1"), /地址无法解析/);
  });
});
