import type { WorkspaceGitChange, WorkspaceTreeEntry } from "@ucode/sdk";

/**
 * 工作区面板的**纯展示逻辑**（F-2.7/F-2.8）。
 *
 * 文件树是**扁平路径列表 → 带缩进的行**（核心层给的是相对路径数组，不是嵌套结构）：
 * 缩进深度由路径段数决定，这样前端不必构造一棵树再递归渲染，筛选也只是过滤这个列表。
 */

export type TreeRow = {
  entry: WorkspaceTreeEntry;
  /** 缩进层级（根下的条目为 0）。 */
  depth: number;
  label: string;
};

export function depthOf(path: string): number {
  return Math.max(0, path.split("/").length - 1);
}

export function buildTreeRows(entries: readonly WorkspaceTreeEntry[]): TreeRow[] {
  return [...entries]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({
      entry,
      depth: depthOf(entry.path),
      label: entry.name,
    }));
}

/** 关键词筛选：匹配路径或文件名（大小写不敏感）。 */
export function filterTreeRows(rows: readonly TreeRow[], keyword: string): TreeRow[] {
  const needle = keyword.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) => row.entry.path.toLowerCase().includes(needle));
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);

export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTS.has(path.slice(dot).toLowerCase());
}

export function formatBytes(size: number | undefined): string {
  if (size === undefined) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(entry: WorkspaceTreeEntry): string {
  if (entry.kind === "dir") return "▸";
  if (isImagePath(entry.path)) return "▣";
  return "·";
}

/** git status 的两字符码 → 可读标签与色调（M/A/D/R/?? 等）。 */
export function changeStatusLabel(status: string): {
  label: string;
  tone: "accent" | "warn" | "danger" | "muted";
} {
  const code = status.replace(/\s/gu, "").toUpperCase();
  if (code === "??") return { label: "未跟踪", tone: "muted" };
  if (code.includes("D")) return { label: "删除", tone: "danger" };
  if (code.includes("A")) return { label: "新增", tone: "accent" };
  if (code.includes("R")) return { label: "改名", tone: "warn" };
  if (code.includes("M")) return { label: "修改", tone: "warn" };
  return { label: code === "" ? "变更" : code, tone: "muted" };
}

/** 变更列表按状态聚类时的排序权重（新增/修改在前，未跟踪在后）。 */
export function sortChanges(changes: readonly WorkspaceGitChange[]): WorkspaceGitChange[] {
  const weight = (status: string): number => {
    const code = status.replace(/\s/gu, "").toUpperCase();
    if (code === "??") return 3;
    if (code.includes("D")) return 2;
    return 1;
  };
  return [...changes].sort(
    (a, b) => weight(a.status) - weight(b.status) || a.path.localeCompare(b.path),
  );
}
