// 核心层通过协议驱动插件域的端到端测试。

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  command,
  connect,
  dataDir,
  handshake,
  setup,
  teardown,
} from "../../testing/core-harness.ts";
import { discoverResources } from "../index.ts";

afterEach(() => teardown());

describe("核心层：插件（F-3.5）", () => {
  it("数据层 extensions/ 下的插件被加载，其注册的工具可被 agent 调用", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const extensionsDir = join(dataDir as string, "extensions");
    await mkdir(extensionsDir, { recursive: true });
    // 不 import 任何包（临时数据层没有 node_modules）：直接用传给工厂的 pi 注册工具。
    await writeFile(
      join(extensionsDir, "echo.js"),
      [
        "export default function (pi) {",
        "  pi.registerTool({",
        '    name: "plugin_echo",',
        '    label: "Echo",',
        '    description: "Echo back the given text",',
        '    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },',
        "    async execute(_id, params) {",
        '      return { content: [{ type: "text", text: "PLUGIN:" + params.text }], details: {} };',
        "    },",
        "  });",
        "}",
      ].join("\n"),
    );

    fake.queue([{ toolCalls: [{ name: "plugin_echo", args: { text: "hi" } }] }, { text: "完成" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "调用插件工具" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    const history = await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    });
    const records = (history.data as { records: unknown[] }).records;
    expect(JSON.stringify(records)).toContain("PLUGIN:hi");
  });

  it("发现接口列出数据层里装的资源", async () => {
    const { core: target } = await setup();
    await mkdir(join(dataDir as string, "skills", "demo"), { recursive: true });
    await writeFile(
      join(dataDir as string, "skills", "demo", "SKILL.md"),
      "---\nname: demo\n---\n",
    );
    void target;
    const resources = await discoverResources(dataDir as string);
    expect(
      resources.some((resource) => resource.kind === "skill" && resource.name === "demo"),
    ).toBe(true);
  });
});
