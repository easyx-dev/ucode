/**
 * 兜底看门狗单测：绝大多数用例用假的 `BashOperations` 验触发条件与错误协议（毫秒级阈值、快跑），
 * 末尾一条接 pi 真实 shell 后端，确认进程真的被终止。
 */
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

import { withShellGuard } from "../guard";

const GUARD = { idlenessMs: 50, defaultTimeoutSeconds: 7 };

/** 底层执行：命令不产出任何输出，只等信号 —— 等价于「停在交互输入上」 */
const hangUntilAborted = (onStart?: (timeout: number | undefined) => void): BashOperations => ({
  exec: (_command, _cwd, options) =>
    new Promise((_resolve, reject) => {
      onStart?.(options.timeout);
      assert.ok(options.signal, "未把信号传给底层执行");
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    }),
});

describe("withShellGuard", () => {
  it("空转即中止，并先把原因写进输出，错误按超时上报", async () => {
    const chunks: string[] = [];
    let seenTimeout: number | undefined;
    const operations = withShellGuard(
      hangUntilAborted((timeout) => {
        seenTimeout = timeout;
      }),
      GUARD,
    );

    await assert.rejects(
      operations.exec("git rebase --continue", "/tmp", {
        onData: (data) => chunks.push(data.toString()),
        env: {},
      }),
      /timeout:0\.05/,
    );
    // 未显式指定 timeout 时用默认上限
    assert.equal(seenTimeout, 7);
    assert.match(chunks.join(""), /等待交互输入/);
  });

  it("有输出就重置计时，不误判为空转", async () => {
    const operations = withShellGuard(
      {
        exec: async (_command, _cwd, options) => {
          for (let i = 0; i < 12; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            options.onData(Buffer.from(`tick ${i}\n`));
          }
          return { exitCode: 0 };
        },
      },
      // 单次间隔 50ms 远小于阈值、累计 600ms 已超过阈值：只有「收到输出就重置」才不会被判空转
      { idlenessMs: 300, defaultTimeoutSeconds: 7 },
    );
    const chunks: string[] = [];

    const result = await operations.exec("build", "/tmp", {
      onData: (data) => chunks.push(data.toString()),
      env: {},
    });

    assert.equal(result.exitCode, 0);
    assert.match(chunks.join(""), /tick 11/);
  });

  it("用户中断原样透传，不伪装成超时", async () => {
    const controller = new AbortController();
    const operations = withShellGuard(hangUntilAborted(), {
      idlenessMs: 5_000,
      defaultTimeoutSeconds: 7,
    });

    const pending = operations.exec("sleep 1", "/tmp", {
      onData: () => {},
      env: {},
      signal: controller.signal,
    });
    controller.abort();

    await assert.rejects(pending, (err: Error) => err.message === "aborted");
  });

  it("空转与用户中断叠在一起时报中断，而不是超时", async () => {
    const controller = new AbortController();
    // 底层对信号不敏感（远端执行这类实现），它的拒绝会晚于外部中断到来
    const operations = withShellGuard(
      {
        exec: () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("aborted")), 200);
          }),
      },
      { idlenessMs: 30, defaultTimeoutSeconds: 7 },
    );

    const pending = operations.exec("sleep 1", "/tmp", {
      onData: () => {},
      env: {},
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);

    await assert.rejects(pending, (err: Error) => err.message === "aborted");
  });

  it("模型显式给出的 timeout 不被默认上限覆盖", async () => {
    let seenTimeout: number | undefined;
    const operations = withShellGuard(
      {
        exec: async (_command, _cwd, options) => {
          seenTimeout = options.timeout;
          return { exitCode: 0 };
        },
      },
      GUARD,
    );

    await operations.exec("ls", "/tmp", { onData: () => {}, env: {}, timeout: 1 });

    assert.equal(seenTimeout, 1);
  });

  // 端到端那一步：真实进程要真的被终止，而不是只把信号往下传
  it("真实进程无输出到时限就被终止", async () => {
    const operations = withShellGuard(createLocalBashOperations(), {
      idlenessMs: 300,
      defaultTimeoutSeconds: 60,
    });
    const chunks: string[] = [];

    await assert.rejects(
      operations.exec("sleep 60", tmpdir(), {
        onData: (data) => chunks.push(data.toString()),
        env: process.env,
      }),
      /timeout:0\.3/,
    );
    assert.match(chunks.join(""), /等待交互输入/);
  });
});
