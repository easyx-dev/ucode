import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentToolResult, ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  createTurnJournal,
  journalSize,
  type PreImage,
  planUndo,
  recordPreImage,
  summarizeUndo,
  type TurnJournal,
  type UndoOutcome,
} from "./journal.ts";

/**
 * 按轮撤销文件改动（F-1.4）：注册 `undo_files` 工具，撤销**最近一轮** agent 的文件改动。
 *
 * 为什么在工具调用**之前**记前像：撤不掉的信息只有一种——改动发生前的样子。等"事后"再想
 * 恢复，原内容已经没了。所以这里挂 `tool_call`（在文件被动到之前拿到前像）。
 *
 * 范围：只回滚文件，不动对话历史（对话编辑是 F-1.3 的 `session.edit_entry`）。
 */

/** 会改文件的工具 → 从入参里取路径的字段名。 */
const PATH_FIELDS = ["path", "file_path", "filePath", "target"] as const;
const MUTATING_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "multi_edit",
  "write_file",
  "edit_file",
]);

export function createUndoExtension(): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    let current: TurnJournal = createTurnJournal();
    let lastTurn: TurnJournal | null = null;

    const tool = defineTool({
      name: "undo_files",
      label: "Undo file changes",
      description:
        "撤销**最近一轮**你自己对文件做的改动，把它们恢复到那一轮开始前的样子（全撤或全不撤）。" +
        "只影响文件，不改对话历史。当你意识到上一轮改错了、需要回到起点时调用。",
      parameters: Type.Object({}),
      async execute(): Promise<AgentToolResult<{ reverted: number; failed: number }>> {
        if (lastTurn === null || journalSize(lastTurn) === 0) {
          return {
            content: [{ type: "text", text: "上一轮没有文件改动需要撤销。" }],
            details: { reverted: 0, failed: 0 },
          };
        }
        const outcome = await applyUndo(lastTurn);
        lastTurn = null;
        return {
          content: [{ type: "text", text: summarizeUndo(outcome) }],
          details: { reverted: outcome.reverted.length, failed: outcome.failed.length },
        };
      },
    });

    pi.registerTool(tool);

    pi.on("turn_start", () => {
      current = createTurnJournal();
    });

    pi.on("turn_end", () => {
      if (journalSize(current) > 0) lastTurn = current;
      current = createTurnJournal();
    });

    pi.on("agent_settled", () => {
      // 一轮可能没有 turn_end（例如被中止）：收尾时也把当前日志定格为"上一轮"。
      if (journalSize(current) > 0) lastTurn = current;
      current = createTurnJournal();
    });

    pi.on("tool_call", async (event: ToolCallEvent) => {
      const path = extractPath(event);
      if (path === null || isRecording(current, path) || isRecording(lastTurn, path)) return;
      const pre = await readPreImage(path);
      if (pre !== null) recordPreImage(current, pre);
    });
  };
}

function isRecording(journal: TurnJournal | null, path: string): boolean {
  return journal?.preImages.has(path) === true;
}

function extractPath(event: ToolCallEvent): string | null {
  if (!MUTATING_TOOLS.has(event.toolName)) return null;
  const input = event.input as Record<string, unknown>;
  for (const field of PATH_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

async function readPreImage(path: string): Promise<PreImage | null> {
  try {
    const content = await readFile(path, "utf8");
    return { path, existed: true, content };
  } catch (error) {
    // 文件不存在 → 记住"本来没有"，撤销时删掉新建的文件。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, existed: false, content: null };
    }
    return null; // 其它错误（如是目录）：不记，避免撤销时误删
  }
}

async function applyUndo(journal: TurnJournal): Promise<UndoOutcome> {
  const outcome: UndoOutcome = { reverted: [], failed: [] };
  for (const plan of planUndo(journal)) {
    try {
      if (plan.kind === "restore") {
        await mkdir(dirname(plan.path), { recursive: true });
        await writeFile(plan.path, plan.content, "utf8");
      } else {
        await rm(plan.path, { force: true });
      }
      outcome.reverted.push(plan.path);
    } catch (error) {
      outcome.failed.push({
        path: plan.path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return outcome;
}
