/**
 * 两条传输共用的页面操作：快照（采集 → 编号 → 写回 → 可选 diff）与「这个编号现在能不能动」的判定。
 *
 * 为什么单独一层：服务端受管的实例走 Playwright，桌面端面板走 CDP 转发（见 `desktop/`），但**语义必须一致**
 * ——编号怎么算、ref 失效怎么报、遮挡怎么判，两边只能是同一套。差别在传输，不在语义。
 */
import { BROWSER_INDEX_ATTRIBUTE, BROWSER_REF_ATTRIBUTE } from "../../../constants/browser";
import { probeToError } from "./actions";
import { browserError } from "./errors";
import { applyRefsScript, collectScript, hitTestScript } from "./page-scripts";
import {
  assignRefs,
  diffSnapshots,
  fingerprintOf,
  formatSnapshot,
  indexCandidates,
  type SnapshotCandidate,
  type SnapshotEntry,
  snapshotDefaults,
} from "./snapshot";

/** 在页面里跑一段脚本并取回结果（Playwright 是 `page.evaluate`，桌面端是 `Runtime.evaluate`） */
export type Evaluate = <T>(script: string) => Promise<T>;

export type SnapshotOutcome = {
  entries: SnapshotEntry[];
  /** 给模型的文本（开了 diff 时只含变化部分） */
  text: string;
  truncated: boolean;
  count: number;
};

/**
 * 采集一次快照：编号按 `role + 可访问名` 哈希，写回按「原始序号 → 编号」配对。
 *
 * 取噪只影响这一份快照的元素集合；编号本身不随它变，所以打开它不会让其它元素改号。
 * 写回必须带上原始序号：取噪丢过元素后按下标对齐会把编号写到错位的元素上。
 */
export const captureSnapshot = async (
  evaluate: Evaluate,
  previous: readonly SnapshotEntry[],
  input: { diff: boolean; compact: boolean },
): Promise<SnapshotOutcome> => {
  const raw = await evaluate<SnapshotCandidate[]>(
    collectScript({
      max: snapshotDefaults.maxElements,
      nameMaxChars: snapshotDefaults.nameMaxChars,
      indexAttribute: BROWSER_INDEX_ATTRIBUTE,
      refAttribute: BROWSER_REF_ATTRIBUTE,
    }),
  );
  const indexed = indexCandidates(raw, { compact: input.compact });
  const entries = assignRefs(indexed.map((item) => item.candidate));
  await evaluate(
    applyRefsScript({
      indexAttribute: BROWSER_INDEX_ATTRIBUTE,
      refAttribute: BROWSER_REF_ATTRIBUTE,
      pairs: entries.map((entry, position) => ({
        index: indexed[position]?.index ?? position,
        ref: entry.ref,
      })),
    }),
  );

  const formatted = formatSnapshot(entries);
  const changed =
    input.diff && previous.length > 0 && fingerprintOf(previous) !== fingerprintOf(entries);
  const text = changed
    ? `（本次只回传变化部分，页面共 ${entries.length} 个元素）\n${diffSnapshots(previous, entries).text}`
    : formatted.text;

  return { entries, text, truncated: formatted.truncated, count: entries.length };
};

/** ref 属于最近一次快照才算「认识的」；不属于就是页面变了（或换了标签） */
export const assertRefInSnapshot = (entries: readonly SnapshotEntry[], ref: string): void => {
  if (entries.some((entry) => entry.ref === ref)) return;
  throw browserError("stale_ref", `ref @${ref} 不属于最近一次快照`, {
    hint: "页面可能已变化，请重新调用 browser_snapshot",
  });
};

/**
 * 遮挡与可见性判定（源方案 §6.3）：取元素中心点，用 `elementFromPoint` 看最顶层是不是它自己。
 * `isVisible()` 在这里没用——被遮罩盖住的元素在 DOM 里仍然「可见」，用它只会白等到超时。
 */
export const assertRefActionable = async (evaluate: Evaluate, ref: string): Promise<void> => {
  const probe = await evaluate<Parameters<typeof probeToError>[0]>(
    hitTestScript({ refAttribute: BROWSER_REF_ATTRIBUTE, ref }),
  );
  const error = probeToError(probe, ref);
  if (error) throw error;
};
