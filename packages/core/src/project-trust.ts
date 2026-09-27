import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
} from "@earendil-works/pi-coding-agent";

/**
 * 项目信任门（spec 的安全立场：**绝不执行 clone 来的东西**）。
 *
 * 问题：`DefaultResourceLoader` 会扫描 `<cwd>/.pi/extensions`、`<cwd>/.pi/skills`、
 * 向上查找的 `.agents/skills` 等**项目本地资源**，而基座 `SettingsManager` 的
 * `projectTrusted` **默认是 true**（`dist/core/settings-manager.js:176`）。不显式关掉它，
 * "clone 一个仓库就执行其中代码"是默认行为——与本仓对 hooks 的立场直接冲突。
 *
 * 做法：**默认拒绝**，只有显式授信（记在数据层的 `trust.json`）才放行。
 * 授信记录沿用基座的 `ProjectTrustStore`（`<agentDir>/trust.json`，而我们的 agentDir 就是
 * 数据层目录），因此与 pi 生态同一份文件、同一套语义：`get(cwd)` 会向上找最近的记录，
 * 授信一个父目录即对其子项目生效。
 *
 * 为什么不是"问用户"：核心层是 headless 的，会话装配期未必有可承载交互的控制层；
 * 而"无人应答"按本仓既有策略一律取保守值。要授信走 CLI 的 `trust` 子命令。
 */

/** 该目录下是否存在需要信任门的项目本地资源（没有就不必打扰用户）。 */
export function hasProjectLocalResources(cwd: string): boolean {
  return hasTrustRequiringProjectResources(cwd);
}

function store(dataDir: string): ProjectTrustStore {
  return new ProjectTrustStore(dataDir);
}

/** 已记录的授信决定：`true` 授信、`false` 拒绝、`null` 没记录过。 */
export function projectTrustFor(dataDir: string, cwd: string): boolean | null {
  return store(dataDir).get(cwd);
}

/** 记在数据层的授信决定；`null` 表示清除该记录。 */
export function setProjectTrust(dataDir: string, cwd: string, decision: boolean | null): void {
  store(dataDir).set(cwd, decision);
}

/** 读出已授信的目录清单（`trust.json` 的原始形状：路径 → true/false）。 */
export async function listProjectTrust(dataDir: string): Promise<Record<string, boolean>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dataDir, "trust.json"), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, boolean> = {};
    for (const [path, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[path] = value;
    }
    return out;
  } catch {
    return {}; // 没有这个文件就是"什么都没授信过"
  }
}

export type ProjectTrustDecision = {
  trusted: boolean;
  /** 有项目本地资源、但没被授信——调用方据此给用户一条可操作的提示。 */
  needsDecision: boolean;
};

/**
 * 本会话该不该信任这个工作目录。
 *
 * 只有"存在受门保护的资源"时才需要决策；此时没有显式授信一律拒绝。
 */
export function decideProjectTrust(dataDir: string, cwd: string): ProjectTrustDecision {
  if (!hasProjectLocalResources(cwd)) return { trusted: false, needsDecision: false };
  const remembered = store(dataDir).get(cwd);
  return { trusted: remembered === true, needsDecision: remembered !== true };
}
