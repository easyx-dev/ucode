/**
 * 「把一段内容落进当前输入框」的注入点：宿主（桌面端的浏览器面板）选中页面元素后调用它。
 *
 * 为什么做成 context 而不是往 props 里穿：要落进的是**当前会话的草稿**，它只有工作台这一层拿得到；
 * 而调用方是宿主自己的组件（浏览器面板），中间隔着编辑器区、标签栈好几层。给一个 hook 让调用方就近取，
 * 比把回调沿路透传干净。
 */
import { createContext, type ReactNode, useContext } from "react";

/**
 * 从页面上选中的元素：字段由调用方给（它知道页面），这里只负责落进草稿。
 *
 * `text` 是进消息正文的完整摘要，`label`/`meta` 只用于编辑器里那枚芯片——整段摘要直接铺在输入框里
 * 很难看，收成芯片之后人看得清、模型照样拿到全部字段。
 */
export type PickedPageContext = {
  /** 芯片上的短名（元素的可访问名，没有就退标签） */
  label: string;
  /** 进消息正文的完整摘要（多行） */
  text: string;
  /** 芯片悬停时给的定位信息 */
  meta?: { url: string; title: string; selector: string };
};

const ComposerInsertContext = createContext<((picked: PickedPageContext) => void) | null>(null);

/** 内部使用：由工作台挂上真实现（见 `WorkspaceLayout`） */
export function ComposerInsertProvider({
  insert,
  children,
}: {
  insert: (picked: PickedPageContext) => void;
  children: ReactNode;
}) {
  return <ComposerInsertContext.Provider value={insert}>{children}</ComposerInsertContext.Provider>;
}

/**
 * 取「落进当前输入框」这个动作；没挂（例如工作台不在场）时返回一个空操作——
 * 宿主面板宁可少插一段内容，也不该因为上下文缺失而崩掉。
 */
export const useComposerInsert = (): ((picked: PickedPageContext) => void) =>
  useContext(ComposerInsertContext) ?? (() => undefined);
