/**
 * 工作区包清单的唯一读法。
 *
 * `pnpm-workspace.yaml` 的 `packages` 段是「哪些目录是工作区包」的事实源：manifest 校验按它核对
 * 依赖落点，tests 校验按它找 `__tests__`。两处各写一份目录表就会漂移（新增顶层工程时最容易漏）。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** `pnpm-workspace.yaml` 某个顶层键下的块（手写解析：本文件只用顶层键 + 一层列表 / 映射，够用） */
export const yamlSection = (root: string, key: string): string[] => {
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `));
  if (start < 0) throw new Error(`pnpm-workspace.yaml 里找不到 ${key} 段`);

  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    body.push(trimmed);
  }
  return body;
};

/** 工作区包目录：`packages` 段支持 `dir` 与 `dir/*` 两种写法（后者取一层子目录） */
export const workspaceDirs = (root: string): string[] => {
  const dirs: string[] = [];
  for (const item of yamlSection(root, "packages")) {
    const glob = item.replace(/^-\s*/, "").replace(/^["']|["']$/g, "");
    if (!glob.endsWith("/*")) {
      dirs.push(glob);
      continue;
    }
    const parent = glob.slice(0, -2);
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      // pnpm 也只把带清单的目录当包；无关目录（如 `packages/tmp`、`packages/node_modules`）一律跳过
      if (!entry.isDirectory()) continue;
      if (existsSync(join(root, parent, entry.name, "package.json"))) {
        dirs.push(`${parent}/${entry.name}`);
      }
    }
  }
  return dirs;
};
