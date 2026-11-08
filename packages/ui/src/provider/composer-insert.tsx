/**
 * 「把一段内容落进当前输入框」的注入点：宿主（桌面端的浏览器面板、设计画布）选中东西后调用它。
 *
 * 为什么做成 context 而不是往 props 里穿：要落进的是**当前会话的草稿**，它只有工作台这一层拿得到；
 * 而调用方是工作台自己的组件，中间隔着编辑器区、标签栈好几层。给一个 hook 让调用方就近取，
 * 比把回调沿路透传干净。
 *
 * 两种来源的形状不同（页面元素带整段摘要，设计节点带一个锚点），但落点相同，所以用判别联合分开：
 * 消费方按 `kind` 分支，不需要猜一段文本该怎么解释。
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

/**
 * 从设计画布上选中的节点。
 *
 * 与页面元素同一分工：芯片上是图层路径（人认得），正文里是那个锚点（模型认得）——
 * 锚点由服务端铸造，带会话、页与节点三段，工具侧据它校验归属。
 */
export type PickedDesignNode = {
  /** 芯片上的短名：图层路径，如 `手机屏 / 头部 / 标题` */
  label: string;
  /** 进消息正文的锚点，形如 `@design:<会话>/<页>/<节点>` */
  anchor: string;
};

/** 一次「落进输入框」的来源 */
export type ComposerInsert =
  | ({ kind: "pageElement" } & PickedPageContext)
  | ({ kind: "designNode" } & PickedDesignNode);

export type ComposerInsertFn = (item: ComposerInsert) => void;

const ComposerInsertContext = createContext<ComposerInsertFn | null>(null);

/** 内部使用：由工作台挂上真实现（见 `WorkspaceLayout`） */
export function ComposerInsertProvider({
  insert,
  children,
}: {
  insert: ComposerInsertFn;
  children: ReactNode;
}) {
  return <ComposerInsertContext.Provider value={insert}>{children}</ComposerInsertContext.Provider>;
}

/**
 * 取「落进当前输入框」这个动作；没挂（例如工作台不在场）时返回一个空操作——
 * 宿主面板宁可少插一段内容，也不该因为上下文缺失而崩掉。
 */
export const useComposerInsert = (): ComposerInsertFn =>
  useContext(ComposerInsertContext) ?? (() => undefined);
