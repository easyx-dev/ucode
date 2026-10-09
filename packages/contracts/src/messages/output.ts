/** 消息接口的响应模型；SSE 事件的 data 也复用这里的区块结构 */
import type { SessionScoped } from "../common";
import type {
  CompactionRecord,
  GoalPromptDetails,
  GoalRecord,
  MessageRole,
  ModeRecord,
  PermissionDecision,
  PermissionMode,
  RetryRecord,
  SkillRecord,
  ThinkingLevel,
} from "../constants";

export type MessageBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id: string; name: string; args: unknown }
  | { type: "image"; id: string; mimeType: string; url: string }
  | { type: "file"; id: string; mimeType: string; name: string; size: number; url: string };

/**
 * 权限审批记录：界面据此回放「当时确认过哪次调用、结论是什么」。
 * 只作扩展状态持久化（`custom` 条目），不进模型上下文。
 */
export type PermissionRecord = {
  /** 触发审批的工具名，如 `read` / `bash` */
  tool: string;
  /** 规则匹配到的对象：路径 / 命令 / URL */
  subject: string;
  /** 本次授权覆盖的范围：规则类 ask 是规则串，越界检查是父目录通配 */
  scope: string;
  /** 用户的决定 */
  decision: PermissionDecision;
  /** 发起请求的子会话 id；主会话自身发起时为空（与弹窗一致地标注来源） */
  sourceSessionId?: string;
  /** 发起请求的子会话描述 */
  sourceDescription?: string;
};

export type MessageDTO = {
  id: string;
  role: MessageRole;
  blocks: MessageBlock[];
  /** assistant 专用：产生该回复的模型 id */
  model?: string;
  /** assistant 专用：模型所属 provider id */
  provider?: string;
  /** assistant 专用：产生该回复时生效的推理等级 */
  thinkingLevel?: ThinkingLevel;
  /** tool 专用：与 toolCall block 的 id 对应，便于前端精确合并 */
  toolCallId?: string;
  /** tool 专用 */
  toolName?: string;
  /** tool 专用：`question` 的结构化答复，与调用入参里的 `questions` 同序（每项可多值） */
  questionAnswers?: string[][];
  /** custom 专用：扩展条目的来源标识，界面据此区分界面标记（如忽略计划的标记）与普通扩展消息 */
  customType?: string;
  /** custom 专用：权限审批记录；只有该类型的扩展条目会带上 */
  permissionDecision?: PermissionRecord;
  /** custom 专用：压缩记录；只有该类型的扩展条目会带上 */
  compactionRecord?: CompactionRecord;
  /** custom 专用：目标记录；只有该类型的扩展条目会带上（界面展示 `completed` 那一条） */
  goalRecord?: GoalRecord;
  /** 模式 / 权限档位的变更（`MODE_RECORD_CUSTOM_TYPE` 条目） */
  modeChange?: ModeRecord;
  /** custom 专用：技能命中记录；只有 `SKILL_RECORD_CUSTOM_TYPE` 的 `hit` 条目会带上 */
  skillRecord?: SkillRecord;
  /** custom 专用：模型请求重试记录；只有 `RETRY_RECORD_CUSTOM_TYPE` 会带上 */
  retryRecord?: RetryRecord;
  /** 本条所在这一轮生效的助手模式（沿完整分支推进的最近一条 `MODE_RECORD_CUSTOM_TYPE`） */
  mode?: string;
  /** 这一轮生效的权限档位 */
  permissionMode?: PermissionMode;
  /** custom 专用：目标指令的来源（启动 / 续跑 / 恢复）；只有目标注入的条目会带上 */
  goalPrompt?: GoalPromptDetails;
  isError?: boolean;
  /** 消息产生时间（ISO 8601 UTC）；时间不可用时缺省 */
  createdAt?: string;
  /**
   * assistant 专用：该条回复生成结束、写入会话记录的时刻（ISO 8601 UTC）。
   * pi 的 `message.timestamp` 是开始生成的时刻，回复的真实耗时要靠它与 createdAt 相减得到。
   */
  completedAt?: string;
};

/**
 * 快照里的进行中子智能体（只给服务端还在跑的那些）。
 *
 * 嵌套进度不落盘，只靠 `subagent_start` / `subagent_end` 增量维护——断流期间的结束帧会丢，
 * 客户端会永远停在「执行中」；快照带上清单后，客户端以快照为准收敛。
 */
export type SubagentSnapshot = {
  /** 父会话里发起这次委派的工具调用 id */
  toolCallId: string;
  /** 子会话 id */
  sessionId: string;
  /** 任务简称（服务端已按长度截断） */
  description: string;
};

export type MessageListResponse = SessionScoped & {
  messages: MessageDTO[];
  /** 是否已有落盘会话文件 */
  persisted: boolean;
  /** 会话工作目录 */
  cwd: string;
  /** 是否有活跃生成（进程内的 run 或流式会话） */
  running: boolean;
  /** 仍在进行的子智能体；断流重连后客户端据此重建/收敛嵌套进度 */
  subagents: SubagentSnapshot[];
  /**
   * 快照序号：本响应已包含到该序号为止的全部事件效果。
   * 客户端订阅后丢弃 seq <= 它的实时帧，可无缝接续。
   */
  seq: number;
  /** 投影出的在途消息 id；前端据此把该条标记为生成中 */
  liveMessageId?: string;
};

/** prompt 的受理回执：生成本身由服务端后台推进，与本请求无关 */
export type PromptAdmittedResponse = SessionScoped & {
  admitted: boolean;
};

export type MessageInterruptResponse = SessionScoped & {
  /** 是否真的中断了一个正在跑的 run */
  aborted: boolean;
};

export type MessageIgnorePlanResponse = SessionScoped & {
  /** 本次是否真的写入了忽略标记；本轮末尾已是标记（重复点击）时为 false */
  ignored: boolean;
};

export type MessageApprovePlanResponse = SessionScoped & {
  /** 是否已受理并起了一轮 */
  admitted: boolean;
};
