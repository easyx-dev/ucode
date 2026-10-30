/**
 * 两份协议副本的一致性守卫。
 *
 * hub 独立成仓（submodule）后，隧道协议在 UCode 侧（`packages/hub-protocol`）与 hub 侧
 * （hub 仓库的 `packages/protocol`，即 `hub/packages/protocol`）各留一份——这样 ucode 的安装、
 * 类型检查与打包都不依赖 submodule 是否初始化。代价是改协议要改两处，这里把漂移变成显式失败：
 * 逐文件比字节（只比协议本体，`__tests__` 随各仓的测试框架）。
 *
 * submodule 未初始化时 `hub/packages/protocol` 不存在，此时跳过（不是漂移）；CI 以
 * `submodules: recursive` 检出，跳过只应出现在本地。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { listFiles } from "../files.ts";

const LOCAL_DIR = "packages/hub-protocol/src";
const HUB_DIR = "hub/packages/protocol/src";

/** 目录下的仓库相对文件路径（去掉目录前缀）；`__tests__` 不比：两侧测试框架不同（UCode 用 node:test、hub 用 Vitest） */
const sources = (root: string, dir: string): string[] =>
  listFiles(root, dir, () => true)
    .map((path) => path.slice(dir.length + 1))
    .filter((path) => !path.includes("__tests__"));

export const run = (root: string): string[] => {
  if (!existsSync(join(root, HUB_DIR))) {
    console.log("  hub-protocol：hub submodule 未初始化，跳过两份副本的比对");
    return [];
  }

  const problems: string[] = [];
  const local = sources(root, LOCAL_DIR);
  const hub = new Set(sources(root, HUB_DIR));

  for (const file of local) {
    if (!hub.has(file)) {
      problems.push(`${LOCAL_DIR}/${file}：hub 侧没有这个文件（${HUB_DIR}/${file}）`);
      continue;
    }
    hub.delete(file);
    const localText = readFileSync(join(root, LOCAL_DIR, file), "utf8");
    const hubText = readFileSync(join(root, HUB_DIR, file), "utf8");
    if (localText !== hubText) {
      problems.push(`${LOCAL_DIR}/${file}：与 ${HUB_DIR}/${file} 内容不一致——改协议要同时改两份`);
    }
  }

  for (const file of hub) {
    problems.push(`${HUB_DIR}/${file}：UCode 侧没有这个文件（${LOCAL_DIR}/${file}）`);
  }

  return problems;
};
