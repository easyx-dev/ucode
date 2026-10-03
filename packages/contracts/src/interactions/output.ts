/** 交互请求与回答的响应模型 */

/** 一条待回答的权限审批：随 `interaction_request` 事件下发，也可经 `interactions/list` 补齐 */
export type PermissionInteraction = {
  requestId: string;
  kind: "permission";
  sessionId: string;
  /** 触发审批的工具名，如 `read` / `bash` */
  tool: string;
  /** 规则匹配到的对象：路径 / 命令 / URL，展示给用户判断 */
  subject: string;
  /** 本次授权覆盖的范围：规则类 ask 是规则串，越界检查是父目录通配 */
  scope: string;
  /** 发起请求的子会话 id 与描述；主会话自身发起时为空（来源标注用） */
  sourceSessionId?: string;
  sourceDescription?: string;
  createdAt: string;
};

/** question 的一个选项：标签 + 说明，说明写清含义与代价 */
export type QuestionOption = {
  label: string;
  description: string;
};

/** question 的一个问题：主题标签 + 完整问题 + 选项；`multiple` 为真时允许多选 */
export type QuestionItem = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
};

/**
 * 一条待回答的提问：模型在信息不足时经 `question` 工具抛出，
 * 前端弹窗收集答案后经 `interactions/respond` 回传（`answers` 与 `questions` 同序）。
 */
export type QuestionInteraction = {
  requestId: string;
  kind: "question";
  sessionId: string;
  questions: QuestionItem[];
  /** 发起提问的子会话 id 与描述；主会话自身发起时为空（来源标注用） */
  sourceSessionId?: string;
  sourceDescription?: string;
  createdAt: string;
};

/** 待回答的交互请求，按 `kind` 判别 */
export type PendingInteraction = PermissionInteraction | QuestionInteraction;

export type InteractionListResponse = {
  interactions: PendingInteraction[];
};

export type InteractionRespondResponse = {
  requestId: string;
  /** 是否命中一条待回答请求并已生效；重复回答或已超时则为 false */
  resolved: boolean;
};
