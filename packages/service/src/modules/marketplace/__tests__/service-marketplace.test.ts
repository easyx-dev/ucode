// 服务层插件市场的端到端测试。

import { mkdir, readFile, writeFile } from "node:fs/promises";
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

describe("服务层：插件市场（F-3.6）", () => {
  it("登记本机源 → 读目录 → 安装 → 已装可见 → 卸载", async () => {
    const { core: target, projectDir: dir } = await setup();
    // 在工作区里造一个本机市场（一个插件、一个提示组件）。
    const pluginDir = join(dir, "market", "demo");
    await mkdir(join(pluginDir, "commands"), { recursive: true });
    await writeFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        description: "演示插件",
        components: { prompts: [{ name: "review", file: "commands/review.md" }] },
      }),
    );
    await writeFile(
      join(pluginDir, "commands", "review.md"),
      "---\ndescription: 审查\n---\n请审查。\n",
    );

    const client = connect(target, "implicit");
    await handshake(client);
    await client.waitFor("welcome");

    const added = await command(client, "marketplace.add_source", {
      args: { name: "local", kind: "local", location: join(dir, "market") },
    });
    expect(added.success).toBe(true);

    const catalog = await command(client, "marketplace.catalog", { args: { source: "local" } });
    expect(
      (catalog.data as { entries: { name: string }[] }).entries.map((entry) => entry.name),
    ).toEqual(["demo"]);

    const installed = await command(client, "marketplace.install", {
      args: { source: "local", plugin: "demo" },
    });
    expect(installed.success).toBe(true);
    expect((installed.data as { readable: string }).readable).toContain("装好 1 项");
    expect(
      await readFile(join(servicePaths(dataDir as string).piDir, "prompts", "review.md"), "utf8"),
    ).toContain("请审查。");

    const overview = await command(client, "marketplace.overview", {});
    const overviewData = overview.data as {
      sources: unknown[];
      installed: { kind: string; name: string }[];
    };
    expect(overviewData.sources).toHaveLength(1);
    expect(
      overviewData.installed.some((item) => item.kind === "prompt" && item.name === "review"),
    ).toBe(true);

    const removed = await command(client, "marketplace.uninstall", {
      args: { kind: "prompt", name: "review" },
    });
    expect(removed.success).toBe(true);
    await expect(
      readFile(join(servicePaths(dataDir as string).piDir, "prompts", "review.md"), "utf8"),
    ).rejects.toThrow();
  });
});
