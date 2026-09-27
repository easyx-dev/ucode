import type { CatalogEntry, InstalledResource, InstallResult } from "@ucode/sdk";

/**
 * 插件市场的**纯展示逻辑**（F-3.6）。
 *
 * 抽出来是为了可单测：分组与文案是"面板看着对不对"的核心，且容易在边界上出错
 * （空清单、装了一半、扩展与技能的归属不同）。
 */

export function componentKindLabel(kind: string): string {
  switch (kind) {
    case "skill":
      return "技能";
    case "prompt":
      return "提示/命令";
    case "agent":
      return "子智能体";
    case "extension":
      return "扩展（可执行）";
    case "theme":
      return "主题";
    default:
      return kind;
  }
}

export type InstalledGroup = { kind: string; label: string; items: InstalledResource[] };

/** 已装资源按类型分组（面板按组渲染，空组不显示）。 */
export function groupInstalled(installed: readonly InstalledResource[]): InstalledGroup[] {
  const byKind = new Map<string, InstalledResource[]>();
  for (const resource of installed) {
    const list = byKind.get(resource.kind) ?? [];
    list.push(resource);
    byKind.set(resource.kind, list);
  }
  return [...byKind.entries()]
    .map(([kind, items]) => ({
      kind,
      label: componentKindLabel(kind),
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

export function describeCatalogEntry(entry: CatalogEntry): string {
  const parts: string[] = [];
  if (entry.version !== undefined) parts.push(`v${entry.version}`);
  if (entry.description !== undefined) parts.push(entry.description);
  parts.push(`${entry.components.length} 个组件`);
  return parts.join(" · ");
}

/** 安装结果的忠实摘要：装了几个、跳过几个、失败几个（失败必须看得见）。 */
export function summarizeInstallReport(report: InstallResult): string {
  const parts = [`装好 ${report.installed.length} 项`];
  if (report.skipped.length > 0) parts.push(`跳过 ${report.skipped.length} 项（已存在）`);
  if (report.failed.length > 0) parts.push(`失败 ${report.failed.length} 项`);
  return `${parts.join("；")}。`;
}
