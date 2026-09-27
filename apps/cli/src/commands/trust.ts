import { resolve } from "node:path";
import { getBrand } from "@ucode/branding";
import {
  hasProjectLocalResources,
  listProjectTrust,
  projectTrustFor,
  servicePaths,
  setProjectTrust,
} from "@ucode/service";
import type { TrustOptions } from "../options.ts";
import { log } from "../runtime.ts";

/**
 * 项目信任的授信入口。
 *
 * 服务层**默认不加载项目本地资源**（`<cwd>/.pi/extensions|skills|prompts|themes`、
 * 向上查找的 `.agents/skills`）——那是"clone 一个仓库就执行其中代码"的唯一入口。
 * 授信决定记在数据层的 `trust.json`（与基座同一份文件、同一套语义：授一个父目录，
 * 其子项目都生效）。
 *
 * 这个命令是必需的出口：没有它，安全默认就变成"功能被静默禁用"，用户只会看到
 * 一条警告而不知道怎么办。
 */
export async function runTrust(options: TrustOptions): Promise<number> {
  if (options.command === "list") return listTrust(options.dataDir, options.cwd);

  const target = resolve(options.cwd, options.dir ?? ".");
  if (options.command === "revoke") {
    setProjectTrust(servicePaths(options.dataDir).piDir, target, null);
    log(`已撤销项目信任：${target}`);
    return 0;
  }

  setProjectTrust(servicePaths(options.dataDir).piDir, target, true);
  const name = getBrand().productName;
  log(`已授信：${target}`);
  if (hasProjectLocalResources(target)) {
    log("  该目录的项目本地资源（.pi / .agents/skills）此后会被加载。");
  } else {
    log("  提示：该目录当前没有需要信任门的项目本地资源，授信暂时不改变任何行为。");
  }
  log(`  反悔：${name} trust --revoke <目录>`);
  return 0;
}

async function listTrust(dataDir: string, cwd: string): Promise<number> {
  const entries = await listProjectTrust(servicePaths(dataDir).piDir);
  const paths = Object.keys(entries);
  if (paths.length === 0) {
    log("没有任何项目信任记录。");
  } else {
    log("项目信任记录：");
    for (const path of paths) {
      log(`  ${entries[path] === true ? "已授信" : "已拒绝"}  ${path}`);
    }
  }
  if (hasProjectLocalResources(cwd)) {
    // 判定要用基座的查询语义（它规范化路径、并且会向上找最近的记录）：
    // 直接比对原始字符串会在 macOS 上误判（`/tmp` 与 `/private/tmp` 是同一个地方）。
    const decision = projectTrustFor(servicePaths(dataDir).piDir, cwd);
    log(`当前目录有项目本地资源：${resolve(cwd)}（${describeDecision(decision)}）`);
    if (decision !== true) {
      log(`  未授信 → 本次不加载。要启用：${getBrand().productName} trust`);
    }
  }
  return 0;
}

function describeDecision(decision: boolean | null): string {
  if (decision === true) return "已授信";
  if (decision === false) return "已拒绝";
  return "没有记录";
}
