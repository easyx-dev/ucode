/**
 * 生成中的阶段：界面尾部提示据此换文案、报哪一段时间，并在浮层里给出本步的分段耗时。
 *
 * 起因很具体：一轮里「等模型响应」常常吃掉大半时间（上游排队 + 上传），而界面只有一句「工作中 + 本轮耗时」，
 * 看不出时间花在哪一段。阶段由 SSE 帧推出，四段与每步耗时记录（`StepRecord`）的四段同名同义：
 *
 * - `waitingResponse`：`step_start`（请求发出、或上一步工具执行完毕）→ 响应头到达，含上传与上游排队；
 * - `waitingFirstToken`：响应头到达 → 首个内容帧，推理模型的思考落在这里；
 * - `streaming`：首个内容帧 → 消息结束（流式解码）；
 * - `tool`：工具执行，一步里可能并行多次调用。
 *
 * 另有「等用户」（审批 / 提问挂起）不是阶段而是叠加状态：工具还挂在占位上，阶段仍是 `tool`，界面据此把
 * 文案改报成「等待…」，等用户的时间单独累计（与每步记录同口径：不从工具耗时里扣）。
 *
 * 起点取帧到达时的本地时刻（算时长两边都在本机，不留时钟校正），`step_start` 是服务端给的权威起点：
 * 客户端自己在发送时也会乐观起表，收到它再接上服务端口径。分段按界面看到的阶段切，与每步记录的锚点
 * 差别只在毫秒级的交接上；权威口径在会话 JSONL 的每步记录里，两者不互相校正。
 */
import type { ServerEventPayload } from "@ucode/contracts";

import { asRecord } from "./reducer";

export type PhaseKind = "waitingResponse" | "waitingFirstToken" | "streaming" | "tool";

/** 本步（一次模型往返）已走完的分段耗时，毫秒 */
export type StepSegments = {
  /** 等待模型响应：请求发出 → 响应头到达（含上传与上游排队） */
  response: number;
  /** 等待首帧：响应头到达 → 首个内容帧 */
  firstToken: number;
  /** 生成：首个内容帧 → 消息结束 */
  streaming: number;
  /** 执行工具：首个工具开始 → 最后一个工具结束 */
  tool: number;
  /** 等用户：审批 / 提问挂起的时间，与「执行工具」重叠，单独报 */
  userWait: number;
};

/**
 * 工具阶段里在跑的一次调用。按 id 而不是名字配对，才能处理同名并行（一步里两次 `bash`）
 * 与同一次调用的重复声明；名字只用于界面文案，展示时再去重。
 */
export type RunningTool = {
  /** 工具调用 id；帧里缺失时回落成工具名——配对会退化，但不会把还在跑的调用算成已结束 */
  id: string;
  name: string;
};

/** 挂起中的交互请求：界面据此把文案改报成「等待权限审批 / 等待你的回答」 */
export type PendingWait = { kind: "permission" | "question"; since: number };

export type StreamPhase = {
  kind: PhaseKind;
  /** 本阶段起点：帧到达时的本地时刻（epoch 毫秒），只用于算时长 */
  startedAt: number;
  /** 本步的分段累计；`step_start` 时归零 */
  segments: StepSegments;
  /** `kind` 为 `tool` 时在跑的调用，其余阶段为空数组 */
  tools: RunningTool[];
  /** 挂起中的审批 / 提问；为空表示模型或工具正在自己往前走 */
  waiting: PendingWait | null;
};

const NO_SEGMENTS: StepSegments = {
  response: 0,
  firstToken: 0,
  streaming: 0,
  tool: 0,
  userWait: 0,
};

/** 把某一段已走的时长并进分段累计 */
const accumulate = (segments: StepSegments, kind: PhaseKind, ms: number): StepSegments => {
  const elapsed = Math.max(0, ms);
  switch (kind) {
    case "waitingResponse":
      return { ...segments, response: segments.response + elapsed };
    case "waitingFirstToken":
      return { ...segments, firstToken: segments.firstToken + elapsed };
    case "streaming":
      return { ...segments, streaming: segments.streaming + elapsed };
    case "tool":
      return { ...segments, tool: segments.tool + elapsed };
  }
};

/**
 * 换阶段：先把上一段已走的时长结算进分段，再起新的起点。
 *
 * 等用户的叠加状态跟着阶段延续（一次审批不会因为消息结束而消失），工具名单只属于工具阶段。
 */
const move = (
  phase: StreamPhase | null,
  kind: PhaseKind,
  now: number,
  tools: RunningTool[] = [],
): StreamPhase => ({
  kind,
  startedAt: now,
  segments: phase ? accumulate(phase.segments, phase.kind, now - phase.startedAt) : NO_SEGMENTS,
  tools,
  waiting: phase?.waiting ?? null,
});

/** 起一段新阶段（分段落零）：服务端的 `step_start` 与客户端发送时的乐观起表共用这个形状 */
export const createPhase = (now: number): StreamPhase => ({
  kind: "waitingResponse",
  startedAt: now,
  segments: NO_SEGMENTS,
  tools: [],
  waiting: null,
});

/**
 * 帧到达时的阶段推进；返回原引用表示没变，`patch` 据此跳过通知。
 *
 * 只认「请求的边界」与「交互的起止」这类帧：一步的开始、响应头、首个内容帧、消息结束、工具进出、
 * 审批 / 提问的挂起与结算、本轮落定。其余帧（子智能体关联、后台服务清单、压缩进度）都不改变模型
 * 此刻在做什么，一律保持原阶段。
 */
export const advancePhase = (
  phase: StreamPhase | null,
  frame: ServerEventPayload,
  now: number,
): StreamPhase | null => {
  switch (frame.type) {
    case "step_start":
      // 一步的边界：分段落零重算——客户端发送时那点乐观等待不属于这一步。
      // 不判当前是不是在跑工具：下一次往返必定在工具收尾之后，反而能救回重连时丢掉的 tool_end
      return createPhase(now);

    case "message_start":
      // 只有 assistant 消息代表「这一轮请求回来了」；用户消息与工具结果是 harness 追加的，与上游无关
      return asRecord(frame.data).role === "assistant"
        ? move(phase, "waitingFirstToken", now)
        : phase;

    case "text_delta":
    case "thinking_delta":
    case "tool_call":
      return phase?.kind === "streaming" ? phase : move(phase, "streaming", now);

    case "message_end":
      // 一次往返结束：接下来要么执行工具，要么接着发下一次请求（压缩与 harness 补消息也插在这中间）
      return asRecord(frame.data).role === "assistant"
        ? move(phase, "waitingResponse", now)
        : phase;

    case "tool_start": {
      const data = asRecord(frame.data);
      const name = String(data.toolName ?? "");
      const id = String(data.toolCallId ?? "") || name;
      if (!name || !id) return phase;
      if (phase?.kind !== "tool") return move(phase, "tool", now, [{ id, name }]);
      // 同一步并行多次调用：起点继续报这一批的开始；同一次调用的重复声明不再入账
      if (phase.tools.some((tool) => tool.id === id)) return phase;
      return { ...phase, tools: [...phase.tools, { id, name }] };
    }

    case "tool_end": {
      if (phase?.kind !== "tool") return phase;
      const data = asRecord(frame.data);
      const id = String(data.toolCallId ?? "") || String(data.toolName ?? "");
      // 没记过这次调用（重连后只收到尾帧）就什么都不动
      const tools = phase.tools.filter((tool) => tool.id !== id);
      if (tools.length === phase.tools.length) return phase;
      return tools.length > 0 ? { ...phase, tools } : move(phase, "waitingResponse", now);
    }

    case "interaction_request": {
      // 一次只记一条：并发挂起时后到的那条不重开计时（与服务端的等用户记账同语义）
      if (!phase || phase.waiting) return phase;
      const kind = asRecord(frame.data).kind === "question" ? "question" : "permission";
      return { ...phase, waiting: { kind, since: now } };
    }

    case "interaction_resolved": {
      const waiting = phase?.waiting;
      if (!phase || !waiting) return phase;
      return {
        ...phase,
        waiting: null,
        segments: {
          ...phase.segments,
          userWait: phase.segments.userWait + Math.max(0, now - waiting.since),
        },
      };
    }

    case "agent_settled":
      return null;

    default:
      return phase;
  }
};

/** 分段明细里的一行 */
export type StepSegmentRow = { key: Exclude<keyof StepSegments, "userWait">; ms: number };

const ROW_ORDER: StepSegmentRow["key"][] = ["response", "firstToken", "streaming", "tool"];

/**
 * 本步的分段明细：已走过的分段 + 当前这一段实时的一截，按固定顺序给出（没走到的不列）。
 *
 * `totalMs` 只累加互不重叠的四段（即本步从开始到现在）；`userWaitMs` 单独返回——它与「执行工具」
 * 重叠，并进总数会重复计数。
 */
export const stepBreakdown = (
  phase: StreamPhase,
  now: number,
): { rows: StepSegmentRow[]; totalMs: number; userWaitMs: number } => {
  const segments = accumulate(phase.segments, phase.kind, now - phase.startedAt);
  const rows = ROW_ORDER.map((key) => ({ key, ms: segments[key] })).filter((row) => row.ms > 0);
  const userWaitMs =
    segments.userWait + (phase.waiting ? Math.max(0, now - phase.waiting.since) : 0);

  return { rows, totalMs: rows.reduce((sum, row) => sum + row.ms, 0), userWaitMs };
};
