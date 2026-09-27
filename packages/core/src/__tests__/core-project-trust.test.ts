import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setProjectTrust } from "../project-trust.ts";
import { command, connect, handshake, setup, teardown } from "../testing/core-harness.ts";

/**
 * 项目信任门（安全硬规则：**绝不执行 clone 来的东西**）。
 *
 * 基座的 `projectTrusted` 默认为真，不显式过这道门，`cwd/.pi/extensions/*.ts` 会在我们进程里
 * 被执行且没有任何确认。这组用例用"扩展工厂写一个标记文件"来证明代码是否真的跑了——
 * 比断言配置值硬得多。
 */

afterEach(teardown);

/** 在项目目录里放一个"一被加载就写标记文件"的扩展，返回标记文件路径。 */
async function plantProbeExtension(projectDir: string): Promise<string> {
  const dir = join(projectDir, ".pi", "extensions");
  await mkdir(dir, { recursive: true });
  const marker = join(projectDir, "probe-marker.txt");
  await writeFile(
    join(dir, "probe.ts"),
    [
      'import { writeFileSync } from "node:fs";',
      "export default function probe(): void {",
      `  writeFileSync(${JSON.stringify(marker)}, "loaded", "utf8");`,
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return marker;
}

describe("项目信任门", () => {
  it("默认不加载项目本地扩展；显式授信之后才加载", async () => {
    const { core: target, projectDir } = await setup();
    const marker = await plantProbeExtension(projectDir);

    const client = connect(target, "implicit");
    await handshake(client);

    const first = await command(client, "session.create", { args: { cwd: projectDir } });
    expect(first.success).toBe(true);
    expect(existsSync(marker), "未授信时项目本地扩展不得执行").toBe(false);

    // 不能静默禁用：要有一条用户能照着做的提醒
    const notice = client.messages.find((message) => message.type === "ui.notify");
    expect(notice?.type === "ui.notify" && notice.message).toContain("项目本地资源未加载");

    // 授信后新建会话：新运行时重新装配 loader，项目扩展这时才被加载
    setProjectTrust(target.dataDir, projectDir, true);
    const second = await command(client, "session.create", { args: { cwd: projectDir } });
    expect(second.success).toBe(true);
    expect(existsSync(marker), "授信后项目本地扩展应被加载").toBe(true);
  });

  it("没有项目本地资源时不打扰用户（不产生信任提醒）", async () => {
    const { core: target, projectDir } = await setup();
    const client = connect(target, "implicit");
    await handshake(client);

    await command(client, "session.create", { args: { cwd: projectDir } });
    const notices = client.messages.filter((message) => message.type === "ui.notify");
    expect(notices).toHaveLength(0);
  });
});
