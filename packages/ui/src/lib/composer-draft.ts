/** 输入区草稿：还没发出去的内容与初始设置，按上下文持久化在 localStorage */

import { brand } from "@ucode/brand";

import type { PermissionMode, ThinkingPreference } from "./types";

export type ComposerDraft = {
  /** 输入框里还没发出去的内容（纯文本镜像，含附件位置标记，用于空判定与旧数据） */
  text: string;
  /**
   * 编辑器文档：正文、命令 / 技能 mention、`@` 引用与附件都在节点里，是恢复草稿的唯一依据；
   * 缺省时按 `text` 还原（更早版本存下的草稿）。
   */
  doc?: unknown;
  /** 会话级设置的草稿；只在「还没有会话」时作为新会话的初始设置生效 */
  model?: string;
  /** 档位偏好草稿；`auto` 表示按模式推荐值 */
  thinkingLevel?: ThinkingPreference;
  mode?: string;
  /**
   * 权限档位草稿：只在空态作为新会话的初始设置生效，且只由项目继承而来——
   * 空态不提供改动入口（选择器禁用），免得还没看到会话就随手把审批放宽。
   */
  permissionMode?: PermissionMode;
  /** 「在目录中新建」选定的目录；未选时缺省（会话落到自己的工作区） */
  cwd?: string;
};

/** 还没有会话时的上下文键；已有会话用 `session:<id>` */
export const NEW_SESSION_KEY = "new";

const STORAGE_KEY = `${brand.slug}-composer-drafts`;

/** 上下文键：已有会话按会话分，空态共用一个 */
export const composerKeyOf = (sessionId: string | null): string =>
  sessionId ? `session:${sessionId}` : NEW_SESSION_KEY;

export const emptyDraft = (): ComposerDraft => ({ text: "" });

/**
 * 是否有值得恢复的内容（决定「重新打开时留在草稿态」）。
 * 选了目录也算：用户挑完目录就关掉，应该回到同一份草稿上。
 * 附件与引用不必单看——它们在 `text` 里都有位置标记。
 */
export const hasDraftContent = (draft: ComposerDraft | undefined): boolean =>
  Boolean(draft && (draft.text.trim() !== "" || draft.cwd));

/** 单条草稿的校验：`text` 必须是字符串，其余字段按需保留 */
const toDraft = (value: unknown): ComposerDraft | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.text !== "string") return null;
  return {
    text: item.text,
    ...(item.doc && typeof item.doc === "object" ? { doc: item.doc } : {}),
    ...(typeof item.model === "string" ? { model: item.model } : {}),
    ...(typeof item.thinkingLevel === "string"
      ? { thinkingLevel: item.thinkingLevel as ComposerDraft["thinkingLevel"] }
      : {}),
    ...(typeof item.mode === "string" ? { mode: item.mode as ComposerDraft["mode"] } : {}),
    ...(typeof item.permissionMode === "string"
      ? { permissionMode: item.permissionMode as ComposerDraft["permissionMode"] }
      : {}),
    ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}),
  };
};

/**
 * 读全部草稿：逐条校验，形状不对的直接丢掉。
 * 存得下、读不出（手改、旧版本残留）时不该把首屏渲染带崩。
 */
export const readComposerDrafts = (): Record<string, ComposerDraft> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const drafts: Record<string, ComposerDraft> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const draft = toDraft(value);
      if (draft) drafts[key] = draft;
    }
    return drafts;
  } catch {
    return {};
  }
};

export const writeComposerDrafts = (drafts: Record<string, ComposerDraft>): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // 写不进去（隐私模式）不影响使用
  }
};
