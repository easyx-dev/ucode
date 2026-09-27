// 服务层外部 Agent 导入的端到端测试。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { servicePaths } from "../../../paths.ts";
import {
  command,
  connect,
  dataDir,
  type EntryRecord,
  handshake,
  setup,
  teardown,
  waitForSettles,
} from "../../../testing/service-harness.ts";

afterEach(() => teardown());

describe("服务层：外部 Agent 导入（F-3.9）", () => {
  it("扫描并导入外部命令：复制进数据层、留来源标记、源文件不动", async () => {
    const { core: target, provider: fake, projectDir: dir } = await setup();
    const sourceFile = join(dir, "commands", "review.md");
    await mkdir(join(dir, "commands"), { recursive: true });
    await writeFile(sourceFile, "---\ndescription: 审查\n---\n请审查这段代码。\n");

    fake.queue([
      { toolCalls: [{ name: "import_external", args: { action: "scan" } }] },
      { text: "扫到了" },
      { toolCalls: [{ name: "import_external", args: { action: "apply" } }] },
      { text: "导入了" },
    ]);

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");
    const created = await command(client, "session.create", {
      args: { cwd: dir, autonomy: "full-access" },
    });
    const sessionId = (created.data as { sessionId: string }).sessionId;
    await command(client, "session.attach", { sessionId });

    await command(client, "prompt", { sessionId, args: { text: "看看有什么能导入" } });
    await waitForSettles(client, 1);
    const scan = (await command(client, "session.get_entries", {
      sessionId,
      args: { fromSeq: 0 },
    })) as { data: { records: EntryRecord[] } };
    expect(JSON.stringify(scan.data.records)).toContain("命令");

    await command(client, "prompt", { sessionId, args: { text: "导入它们" } });
    await waitForSettles(client, 2);

    const imported = await readFile(
      join(servicePaths(dataDir as string).piDir, "prompts", "review.md"),
      "utf8",
    );
    expect(imported).toContain("importedFrom: commands/review.md");
    expect(imported).toContain("请审查这段代码");
    // 源文件分毫未动（"不改原配置"这条承诺要能验证）。
    expect(await readFile(sourceFile, "utf8")).toContain("description: 审查");
  });
});
