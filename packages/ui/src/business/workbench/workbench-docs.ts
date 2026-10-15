/**
 * 编辑器区打开的文档：标签集合与激活项，以及打开 / 切换 / 关闭的纯逻辑。
 *
 * 一份文档一个标签；同一份内容重复打开只激活已有标签。标签数上限 8 个，超出丢最早的那个
 * （激活项不动，新开的仍在最右）——但终端不参与丢弃，见 `dropEarliest`。id 由内容与来源构成，
 * 因此同一文件的「预览」与「改动 diff」各占一个标签，互不覆盖。
 */
import type { GitCommitSummary, GitDiffSource } from "@ucode/contracts";

export type WorkbenchDoc =
  | { id: string; kind: "file"; path: string }
  | {
      id: string;
      kind: "diff";
      /** 会话工作目录；服务端据此定位仓库 */
      path: string;
      file: string;
      source: GitDiffSource;
      /** 看某次提交里的此文件时给出 */
      commit?: string;
      shortHash?: string;
    }
  /** 全部改动堆叠在一份文档里（每块一个文件），与单文件标签并存 */
  | { id: string; kind: "changes"; path: string }
  | { id: string; kind: "commit"; path: string; commit: GitCommitSummary }
  /**
   * 终端。标签与进程一一对应：关标签即结束终端，所以它不参与「超限丢最早」。
   * 进程活在服务端并活到被显式关掉，工作目录变了标签会清空、进程还在，从侧栏列表能重新打开。
   */
  | { id: string; kind: "terminal"; terminalId: string };

/** 同时打开的标签数上限；超出丢最早的那个 */
export const MAX_WORKBENCH_DOCS = 8;

export const fileDocId = (path: string): string => `file:${path}`;

export const diffDocId = (file: string, source: GitDiffSource, commit?: string): string =>
  `diff:${source}:${commit ?? ""}:${file}`;

export const commitDocId = (hash: string): string => `commit:${hash}`;

/** 「全部改动」的 id 按工作目录区分：同一会话里只会有这一个文档 */
export const changesDocId = (cwd: string): string => `changes:${cwd}`;
export const fileDoc = (path: string): WorkbenchDoc => ({
  id: fileDocId(path),
  kind: "file",
  path,
});

/** 工作区变更的 diff：`staged` 决定比 index 还是比 HEAD */
export const changeDoc = (cwd: string, file: string, staged: boolean): WorkbenchDoc => {
  const source: GitDiffSource = staged ? "staged" : "worktree";
  return { id: diffDocId(file, source), kind: "diff", path: cwd, file, source };
};

/** 某次提交的详情 */
export const commitDoc = (cwd: string, commit: GitCommitSummary): WorkbenchDoc => ({
  id: commitDocId(commit.hash),
  kind: "commit",
  path: cwd,
  commit,
});

/** 全部改动堆叠成一份文档 */
export const changesDoc = (cwd: string): WorkbenchDoc => ({
  id: changesDocId(cwd),
  kind: "changes",
  path: cwd,
});

export const terminalDocId = (terminalId: string): string => `terminal:${terminalId}`;

/** 一个终端一个标签；标题由标签条按序给（服务端不下发名字） */
export const terminalDoc = (terminalId: string): WorkbenchDoc => ({
  id: terminalDocId(terminalId),
  kind: "terminal",
  terminalId,
});

export type WorkbenchDocsState = {
  docs: readonly WorkbenchDoc[];
  activeDocId: string | null;
};

export const emptyWorkbenchDocs: WorkbenchDocsState = { docs: [], activeDocId: null };

const isEmpty = (state: WorkbenchDocsState): boolean =>
  state.docs.length === 0 && state.activeDocId === null;

/**
 * 超出上限时丢最早的那几个，但跳过终端：终端标签与进程一一对应，被挤掉会留下一个看不见的进程。
 * 极端情形（剩下的全是终端）还是得丢，此时进程仍在服务端，从侧栏列表能重新打开。
 */
const dropEarliest = (docs: readonly WorkbenchDoc[]): readonly WorkbenchDoc[] => {
  if (docs.length <= MAX_WORKBENCH_DOCS) return docs;
  const overflow = docs.length - MAX_WORKBENCH_DOCS;
  const dropped = new Set<string>();
  for (const doc of docs) {
    if (dropped.size >= overflow) break;
    if (doc.kind === "terminal") continue;
    dropped.add(doc.id);
  }
  for (const doc of docs) {
    if (dropped.size >= overflow) break;
    dropped.add(doc.id);
  }
  return docs.filter((doc) => !dropped.has(doc.id));
};

export type WorkbenchDocsAction =
  | { type: "open"; doc: WorkbenchDoc }
  | { type: "select"; id: string }
  | { type: "close"; id: string }
  /** 只留右键的那一个（标签右键菜单用） */
  | { type: "closeOthers"; id: string }
  | { type: "closeAll" }
  | { type: "reset" };

export const workbenchDocsReducer = (
  state: WorkbenchDocsState,
  action: WorkbenchDocsAction,
): WorkbenchDocsState => {
  switch (action.type) {
    case "open": {
      const { doc } = action;
      if (state.docs.some((item) => item.id === doc.id)) {
        return { docs: state.docs, activeDocId: doc.id };
      }
      return { docs: dropEarliest([...state.docs, doc]), activeDocId: doc.id };
    }
    case "select":
      return state.activeDocId === action.id ? state : { ...state, activeDocId: action.id };
    case "close": {
      const index = state.docs.findIndex((doc) => doc.id === action.id);
      if (index < 0) return state;
      const docs = state.docs.filter((doc) => doc.id !== action.id);
      if (state.activeDocId !== action.id) return { docs, activeDocId: state.activeDocId };
      // 关掉激活项后接它右边那个，没有则退到左边（与编辑器的习惯一致）
      const next = docs[index] ?? docs[index - 1] ?? null;
      return { docs, activeDocId: next?.id ?? null };
    }
    case "closeOthers": {
      // 右键的那个若已经不在了（并发关标签）就不动，否则会把全部标签清空
      const kept = state.docs.filter((doc) => doc.id === action.id);
      if (kept.length === 0) return state;
      return { docs: kept, activeDocId: action.id };
    }
    case "closeAll":
      return isEmpty(state) ? state : emptyWorkbenchDocs;
    case "reset":
      return isEmpty(state) ? state : emptyWorkbenchDocs;
  }
};
