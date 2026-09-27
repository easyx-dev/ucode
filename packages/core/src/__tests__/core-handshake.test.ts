// 核心层握手与信任矩阵的端到端测试。

import { ALL_CAPABILITIES, PROTOCOL_VERSION, type ServerMessage } from "@ucode/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { command, connect, handshake, setup, teardown } from "../testing/core-harness.ts";

afterEach(() => teardown());

describe("核心层：握手与信任矩阵", () => {
  it("implicit 通路拿到全部能力；版本不兼容被显式拒绝", async () => {
    const { core: target } = await setup();
    const client = connect(target, "implicit");
    await handshake(client);

    const welcome = (await client.waitFor("welcome")) as Extract<
      ServerMessage,
      { type: "welcome" }
    >;
    expect(welcome.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(welcome.trustLevel).toBe("implicit");
    expect(new Set(welcome.grantedCapabilities)).toEqual(new Set(ALL_CAPABILITIES));
    expect(welcome.dataLayerVersion).toBeGreaterThan(0);

    const bad = connect(target, "implicit");
    await bad.send({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION + 5,
      clientId: "bad",
      clientKind: "test",
      binding: "test",
    });
    const rejected = (await bad.waitFor("rejected")) as Extract<
      ServerMessage,
      { type: "rejected" }
    >;
    expect(rejected.code).toBe("version_unsupported");
    expect(rejected.coreProtocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("未认证通路：只读 + 对话；工具直调与免批准执行都被挡住", async () => {
    const { core: target, projectDir: dir } = await setup();

    // 会话由本机通路建好（未认证通路按信任矩阵连"新建会话"都不该有）
    const owner = connect(target, "implicit");
    await handshake(owner);
    await owner.waitFor("welcome");
    const created = await command(owner, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await owner.close();

    const client = connect(target, "untrusted");
    await handshake(client);
    const welcome = (await client.waitFor("welcome")) as Extract<
      ServerMessage,
      { type: "welcome" }
    >;
    expect(welcome.trustLevel).toBe("untrusted");
    expect(new Set(welcome.grantedCapabilities)).toEqual(new Set(["sessions.read", "prompt.run"]));

    // 声明了能力但没被授予：拒绝理由是"信任不足"，不是"承载不了"（可诊断性）
    const deniedCreate = await command(client, "session.create", { args: { cwd: dir } });
    expect(deniedCreate.success).toBe(false);
    expect(deniedCreate.error?.code).toBe("unsupported_capability");
    expect(deniedCreate.error?.details).toMatchObject({
      needed: "sessions.write",
      trustLevel: "untrusted",
    });

    // 只读命令可用
    const attached = await command(client, "session.attach", { sessionId });
    expect(attached.success).toBe(true);

    // 工具直调：未认证通路必须被裁掉
    const bash = await command(client, "bash", { sessionId, args: { command: "echo hi" } });
    expect(bash.success).toBe(false);
    expect(bash.error?.code).toBe("unsupported_capability");

    // 自主级别门槛：这条会话是"完全访问"（免批准执行），未认证通路不得驱动它
    const prompt = await command(client, "prompt", { sessionId, args: { text: "你好" } });
    expect(prompt.success).toBe(false);
    expect(prompt.error?.code).toBe("autonomy_denied");
  });
});
