import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { storePaths, writeFileAtomic } from "@ucode/store";
import { FRONTMATTER_FENCE } from "../util/frontmatter.ts";
import {
  type DiscoveredSource,
  discoverExternalSources,
  type ExternalOrigin,
  type ImportKind,
} from "./sources.ts";

/**
 * 外部资源的**导入**（F-3.9）：把发现到的资源复制进我们的数据层。
 *
 * 三条原则：
 * 1. **只读源**：全程不写外部目录，用户原来的 agent 配置分毫不动；
 * 2. **不静默覆盖**：目标已存在就跳过并如实报告（除非显式 overwrite）——用户自己改过的
 *    技能/子智能体不该被一次导入悄悄冲掉；
 * 3. **留来源**：复制出来的 Markdown 在 frontmatter 里写上 `importedFrom` / `importOrigin`，
 *    以后看到这个文件就知道"它是从哪导进来的"，而不是凭空出现的。
 */

export type ImportedEntry = { kind: ImportKind; name: string; from: string; to: string };

export type SkippedEntry = {
  kind: ImportKind;
  name: string;
  from: string;
  reason: "exists" | "invalid";
};

export type ImportReport = {
  imported: ImportedEntry[];
  skipped: SkippedEntry[];
  /** MCP 声明只登记不运行（我们没有 MCP 运行时），如实单列。 */
  mcp: { from: string; servers: string[] }[];
};

export type ImportOptions = {
  dataDir: string;
  /** 外部目录根（其下按已知布局找资源）。 */
  root: string;
  overwrite?: boolean;
  /** 只导入这些类别（省略=全部）。 */
  kinds?: ImportKind[];
};

export async function importExternalSources(options: ImportOptions): Promise<ImportReport> {
  const discovered = await discoverExternalSources(options.root);
  const wanted =
    options.kinds === undefined
      ? discovered
      : discovered.filter((source) => options.kinds?.includes(source.kind));

  const report: ImportReport = { imported: [], skipped: [], mcp: [] };

  for (const source of wanted) {
    if (source.kind === "mcp") {
      const servers = await readMcpServers(source.path);
      report.mcp.push({ from: source.relativePath, servers });
      continue;
    }

    let content: string;
    try {
      content = await readFile(source.path, "utf8");
    } catch {
      report.skipped.push({
        kind: source.kind,
        name: source.name,
        from: source.relativePath,
        reason: "invalid",
      });
      continue;
    }

    const destination = destinationFor(options.dataDir, source);
    if (!options.overwrite && (await exists(destination))) {
      report.skipped.push({
        kind: source.kind,
        name: source.name,
        from: source.relativePath,
        reason: "exists",
      });
      continue;
    }

    const withSource = withProvenance(content, {
      origin: source.origin,
      relativePath: source.relativePath,
    });
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFileAtomic(destination, withSource, { mode: 0o600 });
    report.imported.push({
      kind: source.kind,
      name: source.name,
      from: source.relativePath,
      to: destination,
    });
  }

  if (report.mcp.length > 0) {
    await mkdir(storePaths(options.dataDir).dataDir, { recursive: true, mode: 0o700 });
    await writeFileAtomic(
      join(options.dataDir, "imported-mcp.json"),
      JSON.stringify({ registrations: report.mcp }, null, 2),
      { mode: 0o600 },
    );
  }

  return report;
}

/** 各类资源落到数据层的哪里：技能→`skills/<name>/SKILL.md`，命令/上下文→`prompts/`，子智能体→`agents/`。 */
export function destinationFor(dataDir: string, source: DiscoveredSource): string {
  const paths = storePaths(dataDir);
  switch (source.kind) {
    case "skill":
      return join(paths.skills, source.name, "SKILL.md");
    case "command":
      return join(paths.prompts, `${source.name}.md`);
    case "agent":
      return join(paths.agents, `${source.name}.md`);
    case "context":
      return join(paths.prompts, `${source.name}-context.md`);
    case "mcp":
      return join(dataDir, "imported-mcp.json");
  }
}

/** 在 Markdown 的 frontmatter 里写上来源（已有 frontmatter 就并进去，没有就新建一段）。 */
export function withProvenance(
  markdown: string,
  provenance: { origin: ExternalOrigin; relativePath: string },
): string {
  const lines = markdown.split(/\r?\n/u);
  const additions = [
    `importedFrom: ${provenance.relativePath}`,
    `importOrigin: ${provenance.origin}`,
  ];
  if (lines[0]?.trim() === FRONTMATTER_FENCE) {
    let end = -1;
    for (let index = 1; index < lines.length; index += 1) {
      if (lines[index]?.trim() === FRONTMATTER_FENCE) {
        end = index;
        break;
      }
    }
    if (end !== -1) {
      const existing = lines.slice(1, end);
      // 已经标记过来源就不重复写（重复导入同一份不会层层叠加）。
      const already = existing.some((line) => line.trim().startsWith("importedFrom:"));
      if (already) return markdown;
      return [...[lines[0]], ...existing, ...additions, ...lines.slice(end)].join("\n");
    }
  }
  return [FRONTMATTER_FENCE, ...additions, FRONTMATTER_FENCE, "", markdown].join("\n");
}

async function readMcpServers(path: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as { mcpServers?: unknown };
    const servers = parsed.mcpServers;
    if (typeof servers !== "object" || servers === null) return [];
    return Object.keys(servers);
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/** 生成一段可读摘要（工具回执与日志用）。 */
export function summarizeImport(report: ImportReport): string {
  const parts: string[] = [];
  parts.push(`导入 ${report.imported.length} 项`);
  if (report.skipped.length > 0) {
    const exists = report.skipped.filter((item) => item.reason === "exists").length;
    parts.push(`跳过 ${report.skipped.length} 项（其中已存在 ${exists} 项）`);
  }
  if (report.mcp.length > 0) {
    const servers = report.mcp.flatMap((entry) => entry.servers);
    parts.push(`登记 MCP 声明 ${servers.length} 个（未接入运行时）`);
  }
  return `${parts.join("；")}。`;
}
