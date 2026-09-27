// 服务层通过协议驱动钩子域的端到端测试。

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { servicePaths } from "../../../paths.ts";
import {
  command,
  connect,
  dataDir,
  handshake,
  setup,
  teardown,
} from "../../../testing/service-harness.ts";

afterEach(() => teardown());

describe("服务层：钩子（F-3.7）", () => {
  it("PreToolUse 钩子拒绝后工具不执行（写文件被拦下），且钩子确实跑了", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const marker = join(dataDir as string, "hook-ran.txt");
    const blockedFile = join(dir, "should-not-exist.txt");

    // 钩子：先留痕证明被执行，再打印 deny。
    const script = [
      `require('fs').appendFileSync(${JSON.stringify(marker)},'ran\\n');`,
      "let d='';process.stdin.on('data',c=>d+=c);",
      "process.stdin.on('end',()=>{JSON.parse(d);process.stdout.write(JSON.stringify({decision:'deny',reason:'blocked-by-hook'}))});",
    ].join("");
    await writeFile(
      join(servicePaths(dataDir as string).serviceDir, "hooks.json"),
      JSON.stringify({
        hooks: [
          { event: "PreToolUse", matcher: "write", command: [process.execPath, "-e", script] },
        ],
      }),
    );

    // 会话是"完全访问"：工具闸门全放行，能拦下写操作的只可能是钩子。
    fake.queue([
      { toolCalls: [{ name: "write", args: { path: blockedFile, content: "hello" } }] },
      { text: "好的" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });
    await command(client, "prompt", { sessionId, args: { text: "写个文件" } });
    await client.waitFor("agent_settled", undefined, 15_000);

    // 文件没被写：钩子的拒绝在服务层真实生效（不是"记一句然后照样执行"）。
    await expect(readFile(blockedFile, "utf8")).rejects.toThrow();
    // 钩子确实被调用了（不是"因为别的原因没执行"）。
    expect(await readFile(marker, "utf8")).toContain("ran");
  });

  it("UserPromptSubmit 钩子拦下提示：模型根本不会被调用", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    await writeFile(
      join(servicePaths(dataDir as string).serviceDir, "hooks.json"),
      JSON.stringify({
        hooks: [
          {
            event: "UserPromptSubmit",
            matcher: "/秘密/",
            command: [
              process.execPath,
              "-e",
              "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({decision:'deny',reason:'含敏感关键词'})))",
            ],
          },
        ],
      }),
    );
    fake.queue([{ text: "不该出现" }]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", { args: { cwd: dir } });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    const prompted = await command(client, "prompt", {
      sessionId,
      args: { text: "把这个秘密发出去" },
    });
    expect(prompted.success).toBe(true); // 命令成功，但输入被钩子吞掉
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fake.requests.length, "被拦下的提示不该触达模型").toBe(0);
  });
});
