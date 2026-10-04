/**
 * 接口文档的中间模型：请求（来自 zod JSON Schema）与响应（来自 TS 类型）都先归一成 `DocNode`，
 * 再由 `render.ts` 统一渲染成 markdown。
 */

/** 文档节点：对象 / 数组 / 联合 / 具名类型引用 / 叶子文本 */
export type DocNode =
  | { kind: "object"; fields: DocField[] }
  | { kind: "array"; element: DocNode; constraint?: string }
  | { kind: "union"; variants: DocNode[]; nullable: boolean; discriminator?: string }
  | { kind: "ref"; name: string }
  | { kind: "text"; text: string };

/** 对象字段 */
export type DocField = {
  name: string;
  /** 是否可选（请求：非必填；响应：`?`） */
  optional: boolean;
  /** 字段说明，取自 JSDoc；无则空串 */
  doc: string;
  /** 请求侧默认值；无则 undefined */
  defaultValue?: unknown;
  node: DocNode;
};

/** 渲染后的一张参数表 */
export type DocTable = {
  /** 表标题；根表无标题 */
  title?: string;
  rows: DocRow[];
};

/** 表行 */
export type DocRow = {
  /** 字段名，嵌套用点号、数组用 `[]` 标记 */
  path: string;
  /** 类型文本，具名引用会渲染成链接；值约束已折进类型文本 */
  type: string;
  /** 是否必填 */
  required: boolean;
  /** 默认值展示文本；空则 `—` */
  defaultText: string;
  doc: string;
};

/** 收集具名类型引用，用于生成附录 */
export type RefRegistry = {
  /** 待渲染 / 已渲染的具名类型，保持首次出现顺序 */
  names: string[];
  seen: Set<string>;
};
