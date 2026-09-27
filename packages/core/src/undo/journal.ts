/**
 * 按轮撤销文件改动的**日志与回滚计划**（F-1.4）。
 *
 * 做法：在工具真正改文件**之前**记下它的前像（原内容，或"本来不存在"）。
 * 一轮结束时把这一轮的日志收成"上一轮"，撤销时按它把这些文件恢复原样。
 *
 * 抽成纯函数是为了可单测：真正的文件读写留在扩展里，这里只决定"要做什么"。
 * 语义是**全撤或全不撤**——不做"只回滚其中几个文件"这种中间态（半撤的工作区最难理解）。
 */

export type PreImage = {
  /** 目标文件绝对路径。 */
  path: string;
  /** 改动前是否存在。 */
  existed: boolean;
  /** 改动前的内容（existed 为假时无意义）。 */
  content: string | null;
};

export type UndoPlan =
  | { kind: "restore"; path: string; content: string }
  | { kind: "delete"; path: string };

export type TurnJournal = {
  /** 本轮被改动过的文件 → 前像（同一文件多次改动只保留**最早**的前像）。 */
  preImages: Map<string, PreImage>;
};

export function createTurnJournal(): TurnJournal {
  return { preImages: new Map() };
}

/** 记录前像：同一文件本轮被改多次时，保留最早那次的前像（撤销要回到轮的起点）。 */
export function recordPreImage(journal: TurnJournal, pre: PreImage): void {
  if (journal.preImages.has(pre.path)) return;
  journal.preImages.set(pre.path, pre);
}

export function journalSize(journal: TurnJournal): number {
  return journal.preImages.size;
}

/** 把一轮的日志变成回滚计划（顺序稳定，便于测试与执行）。 */
export function planUndo(journal: TurnJournal): UndoPlan[] {
  const plans: UndoPlan[] = [];
  for (const [path, pre] of [...journal.preImages].sort(([a], [b]) => a.localeCompare(b))) {
    if (pre.existed && pre.content !== null)
      plans.push({ kind: "restore", path, content: pre.content });
    else plans.push({ kind: "delete", path });
  }
  return plans;
}

/** 一次撤销的执行结果（失败要看得见，不能假装撤干净了）。 */
export type UndoOutcome = {
  reverted: string[];
  failed: { path: string; error: string }[];
};

export function summarizeUndo(outcome: UndoOutcome): string {
  if (outcome.failed.length === 0) {
    return outcome.reverted.length === 0
      ? "上一轮没有文件改动需要撤销。"
      : `已把上一轮改动的 ${outcome.reverted.length} 个文件恢复到改动前。`;
  }
  const failed = outcome.failed.map((item) => `${item.path}（${item.error}）`).join("、");
  return `部分文件未能恢复：${failed}。已恢复 ${outcome.reverted.length} 个。`;
}
