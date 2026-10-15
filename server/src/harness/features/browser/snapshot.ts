/**
 * 页面元素快照：把页面整理成「role + 可访问名 + `@eN`」列表。
 *
 * 编号按 `role + 可访问名`（同名再带序号）的哈希来，**不是递增序号**——页面多出一个 toast 或
 * 遮罩时，已有元素的 ref 不会错位，只有新元素拿到新号（源方案 §6.1）。导航后编号表整体作废，
 * 由调用方清空并强制重新快照（源方案 §6.4）。
 *
 * 两个页面侧函数（`collectCandidates` / `applyRefs`）会被序列化进页面执行，因此不能引用本模块
 * 作用域里的任何东西：所需的属性名与上限都从入参传进去。
 */
import {
  BROWSER_INDEX_ATTRIBUTE,
  BROWSER_NAME_MAX_CHARS,
  BROWSER_REF_ATTRIBUTE,
  BROWSER_REF_LENGTH,
  BROWSER_SNAPSHOT_MAX_CHARS,
  BROWSER_SNAPSHOT_MAX_ELEMENTS,
} from "../../../constants/browser";

/** 页面侧采集出的候选元素：跨进程边界只有普通对象 */
export type SnapshotCandidate = {
  role: string;
  name: string;
  /** 原始标签名，快照里用于区分同名控件（如两个 input） */
  tag: string;
  /** 值得写进快照的附加状态：值 / 勾选 / 禁用 */
  state?: string;
  /** 整块都在视口之外（取噪时会被丢掉） */
  offscreen?: boolean;
};

export type SnapshotEntry = SnapshotCandidate & { ref: string };

/**
 * 激进取噪（源方案 §11，默认关）：把两类噪声丢掉——没有名字的通用容器，
 * 以及整块落在视口之外的元素。它们既占 token 又常被模型误当成可操作对象。
 *
 * 只在调用方显式要求时生效：丢掉的分支里可能有模型需要的信息，这是它的代价。
 */
export const keepsCandidate = (candidate: SnapshotCandidate): boolean => {
  if (candidate.role === "generic" && candidate.name.trim() === "") return false;
  return candidate.offscreen !== true;
};

export const pruneCandidates = (candidates: readonly SnapshotCandidate[]): SnapshotCandidate[] =>
  candidates.filter(keepsCandidate);

/** 候选元素 + 它在这次采集里的原始序号 */
export type IndexedCandidate = { index: number; candidate: SnapshotCandidate };

/**
 * 取噪并**保留原始序号**：ref 是按序号写回 DOM 的，序号丢了就会把编号写到别的元素上
 * （见 `page-scripts` 的 `applyRefsScript`）。
 */
export const indexCandidates = (
  candidates: readonly SnapshotCandidate[],
  options: { compact?: boolean } = {},
): IndexedCandidate[] =>
  candidates.flatMap((candidate, index) =>
    options.compact === true && !keepsCandidate(candidate) ? [] : [{ index, candidate }],
  );

/** FNV-1a 32 位：短、够散、无依赖；编号不需要抗碰撞，只要同页同键稳定 */
const fnv1a = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const toBase36 = (value: number, length: number): string =>
  value.toString(36).padStart(length, "0").slice(-length);

/**
 * 稳定键：role + 名字 + 同键出现序号。
 * 序号按出现顺序算，所以在最前面插入同类同名元素会让它们集体挪位——同名元素本就无法相互区分，
 * 这是可接受的代价（要区分就看快照里的顺序与附加状态）。
 */
export const candidateKey = (candidate: SnapshotCandidate, ordinal: number): string =>
  `${candidate.role}\u0000${candidate.name}\u0000${ordinal}`;

export const refOfKey = (key: string): string => `e${toBase36(fnv1a(key), BROWSER_REF_LENGTH)}`;

/** 给候选元素编号：同键必然同号，撞号时向后探测，保证一份快照内 ref 唯一 */
export const assignRefs = (candidates: readonly SnapshotCandidate[]): SnapshotEntry[] => {
  const ordinals = new Map<string, number>();
  const taken = new Set<string>();
  return candidates.map((candidate) => {
    const base = `${candidate.role}\u0000${candidate.name}`;
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    const key = candidateKey(candidate, ordinal);
    let ref = refOfKey(key);
    for (let probe = 1; taken.has(ref); probe += 1) ref = refOfKey(`${key}\u0000${probe}`);
    taken.add(ref);
    return { ...candidate, ref };
  });
};

/** 一行一个元素：`@e1a2 button "登录" [禁用]` */
export const formatEntry = (entry: SnapshotEntry): string =>
  `@${entry.ref} ${entry.role} "${entry.name}"${entry.state ? ` [${entry.state}]` : ""}`;

export type FormattedSnapshot = {
  text: string;
  /** 因为条数或字符上限被截断 */
  truncated: boolean;
};

/** 渲染成给模型的文本；条数与字符两个上限取先到者，截断时在末尾说明 */
export const formatSnapshot = (
  entries: readonly SnapshotEntry[],
  options: { maxElements?: number; maxChars?: number } = {},
): FormattedSnapshot => {
  const maxElements = options.maxElements ?? BROWSER_SNAPSHOT_MAX_ELEMENTS;
  const maxChars = options.maxChars ?? BROWSER_SNAPSHOT_MAX_CHARS;
  const kept: string[] = [];
  let used = 0;
  let truncated = false;

  for (const entry of entries) {
    if (kept.length >= maxElements) {
      truncated = true;
      break;
    }
    const line = formatEntry(entry);
    if (used + line.length + 1 > maxChars) {
      truncated = true;
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }

  const total = entries.length;
  const note = truncated
    ? `\n（共 ${total} 个元素，这里只列出前 ${kept.length} 个；缩小范围或先滚动再快照）`
    : "";
  return { text: `${kept.join("\n")}${note}`, truncated };
};

/** 页面指纹：同一份编号表即视为「页面没变」，供快照缓存复用（见 `plans/browser-tools.md` 第八章） */
export const fingerprintOf = (entries: readonly SnapshotEntry[]): string =>
  toBase36(fnv1a(entries.map((entry) => entry.ref).join("|")), 8);

export type SnapshotDiff = {
  /** 只含新增与消失，以及同名元素的状态变化；差量模式下交给模型的就是这些行 */
  text: string;
  added: SnapshotEntry[];
  removed: SnapshotEntry[];
  changed: string[];
};

/**
 * 差量回传（源方案 §11，默认关）：只把变化的部分交给模型。
 * 调用方必须同时说明「本次只回传了变化部分」，否则模型会以为页面只剩这些元素。
 */
export const diffSnapshots = (
  previous: readonly SnapshotEntry[],
  current: readonly SnapshotEntry[],
): SnapshotDiff => {
  const before = new Map(previous.map((entry) => [entry.ref, entry]));
  const after = new Map(current.map((entry) => [entry.ref, entry]));
  const added = current.filter((entry) => !before.has(entry.ref));
  const removed = previous.filter((entry) => !after.has(entry.ref));
  const changed: string[] = [];
  for (const entry of current) {
    const old = before.get(entry.ref);
    if (old && (old.state !== entry.state || old.name !== entry.name)) {
      changed.push(
        `${formatEntry(entry)}（原为 "${old.name}"${old.state ? ` [${old.state}]` : ""}）`,
      );
    }
  }

  const lines = [
    ...(added.length ? ["新增：", ...added.map((entry) => `+ ${formatEntry(entry)}`)] : []),
    ...(removed.length ? ["消失：", ...removed.map((entry) => `- ${formatEntry(entry)}`)] : []),
    ...(changed.length ? ["变化：", ...changed.map((line) => `~ ${line}`)] : []),
  ];
  return {
    text: lines.length ? lines.join("\n") : "页面结构与上次快照一致",
    added,
    removed,
    changed,
  };
};

/** 快照的默认参数：调用方一般直接用这一份（页面侧脚本见 `page-scripts.ts`） */
export const snapshotDefaults = {
  maxElements: BROWSER_SNAPSHOT_MAX_ELEMENTS,
  maxChars: BROWSER_SNAPSHOT_MAX_CHARS,
  nameMaxChars: BROWSER_NAME_MAX_CHARS,
  indexAttribute: BROWSER_INDEX_ATTRIBUTE,
  refAttribute: BROWSER_REF_ATTRIBUTE,
} as const;
