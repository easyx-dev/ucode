import type { Dirent } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * 外部 Agent 布局的发现（F-3.9）。
 *
 * 目标：把用户**别的 agent 里已有的**资源（技能/命令/子智能体/上下文/MCP 声明）认出来，
 * 再**复制**进我们的数据层。**只读源目录，绝不改它**——别人的配置是别人的，
 * 我们只是"读进来一份"，用户原来的 agent 该怎么跑还怎么跑。
 *
 * 认得的布局（按需扩展，认不出就当没有）：
 * - Claude Code 系：`.claude-plugin/plugin.json`、`commands/*.md`、`agents/*.md`、`skills/<name>/SKILL.md`、`.mcp.json`
 * - `.agents/` 通用约定：其中的 `skills/`、`agents/`、`commands/`
 * - 顶层 `AGENTS.md`（上下文说明）
 */

export type ImportKind = "skill" | "command" | "agent" | "context" | "mcp";

export type ExternalOrigin = "claude" | "agents" | "generic";

export type DiscoveredSource = {
  kind: ImportKind;
  /** 导入后的名字（技能用目录名，命令/子智能体用文件名）。 */
  name: string;
  /** 源文件绝对路径（**只读**）。 */
  path: string;
  /** 相对源目录根的路径（写进来源标记）。 */
  relativePath: string;
  origin: ExternalOrigin;
};

export function kindLabel(kind: ImportKind): string {
  switch (kind) {
    case "skill":
      return "技能";
    case "command":
      return "命令";
    case "agent":
      return "子智能体";
    case "context":
      return "上下文说明";
    case "mcp":
      return "MCP 声明";
  }
}

export async function discoverExternalSources(root: string): Promise<DiscoveredSource[]> {
  const found: DiscoveredSource[] = [];

  // 顶层 AGENTS.md：外部 agent 的"项目说明"，导入后作为提示模板保留。
  if (await isFile(join(root, "AGENTS.md"))) {
    found.push({
      kind: "context",
      name: "AGENTS",
      path: join(root, "AGENTS.md"),
      relativePath: "AGENTS.md",
      origin: "generic",
    });
  }

  // Claude Code 插件清单与 MCP 声明。
  if (await isFile(join(root, ".claude-plugin", "plugin.json"))) {
    found.push({
      kind: "mcp",
      name: "claude-plugin",
      path: join(root, ".claude-plugin", "plugin.json"),
      relativePath: ".claude-plugin/plugin.json",
      origin: "claude",
    });
  }
  if (await isFile(join(root, ".mcp.json"))) {
    found.push({
      kind: "mcp",
      name: "mcp",
      path: join(root, ".mcp.json"),
      relativePath: ".mcp.json",
      origin: "claude",
    });
  }

  // 目录型资源：命令 / 子智能体 / 技能。
  await collectDir(found, root, "commands", "command", "claude");
  await collectDir(found, root, "agents", "agent", "claude");
  await collectDir(found, root, join("skills"), "skill", "claude");

  // `.agents/` 约定目录（与上面同构，只是前缀不同）。
  await collectDir(found, root, join(".agents", "commands"), "command", "agents");
  await collectDir(found, root, join(".agents", "agents"), "agent", "agents");
  await collectDir(found, root, join(".agents", "skills"), "skill", "agents");

  return found.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.relativePath.localeCompare(b.relativePath),
  );
}

/** 收集一个资源目录：命令/子智能体是 `*.md` 文件，技能是含 `SKILL.md` 的子目录。 */
async function collectDir(
  found: DiscoveredSource[],
  root: string,
  relativeDir: string,
  kind: Extract<ImportKind, "command" | "agent" | "skill">,
  origin: ExternalOrigin,
): Promise<void> {
  const dir = join(root, relativeDir);
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRelative = `${relativeDir}/${entry.name}`;
    const childPath = join(root, childRelative);
    if (kind === "skill") {
      if (!entry.isDirectory()) continue;
      const skillFile = join(childPath, "SKILL.md");
      if (await isFile(skillFile)) {
        found.push({
          kind: "skill",
          name: entry.name,
          path: skillFile,
          relativePath: `${childRelative}/SKILL.md`,
          origin,
        });
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    found.push({
      kind,
      name: entry.name.replace(/\.md$/u, ""),
      path: childPath,
      relativePath: childRelative,
      origin,
    });
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}
