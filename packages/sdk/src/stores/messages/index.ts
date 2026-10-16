/**
 * 会话消息流管理器：按 sessionId 维护引擎、路由全局事件、负责取快照与发送。
 *
 * 每个会话一个 store，全局事件流按 sessionId 路由帧，因此后台会话也能保持最新；
 * React 侧只订阅 store，不关心连接与归并细节。
 */
import { ERROR_CODES, type ServerEventPayload } from "@ucode/contracts";

import type { Apis } from "../../apis";
import { asApiError, toApiError } from "../../error";
import type { EventStream } from "../../events";
import { createStore, type Store } from "../../store";
import type { EditMessagePayload, PromptPayload, SubagentStreams } from "../../types";
import {
  applyChildFrame,
  applyFrame,
  asServices,
  createEngine,
  EMPTY_STATE,
  type Engine,
  optimisticBlocks,
  patch,
  type SessionStreamState,
} from "./engine";
import { createPhase } from "./phase";
import { appendUserItem, isLiveUid, removeUserItem, settle } from "./reducer";

export type { SessionStreamState } from "./engine";
export type { PhaseKind, StepSegmentRow, StepSegments, StreamPhase } from "./phase";
export { createPhase, stepBreakdown } from "./phase";

export type MessagesStore = {
  /** 取某个会话的 store；sessionId 为 null 时返回共享的空 store */
  get: (sessionId: string | null) => Store<SessionStreamState>;
  /** 标记会话为当前激活：首次激活时取快照 */
  activate: (sessionId: string | null) => void;
  /** 登记一个刚建好的空会话：已知无历史，避免切换时多余地取快照 */
  seed: (sessionId: string) => void;
  /** 强制取一次快照（如首条消息受理后，用权威条目替换乐观消息） */
  refresh: (sessionId: string) => void;
  /**
   * 重探并刷新后台服务清单（活动面板打开时调）。
   * 走单独的轻量接口，不重取整段消息历史。
   */
  refreshServices: (sessionId: string) => Promise<void>;
  /** 发送一条消息并乐观插入；返回是否被服务端受理 */
  send: (sessionId: string, payload: PromptPayload) => Promise<boolean>;
  /** 编辑一条用户消息并重发；引用与附件一并带上，刷新由 transcript_reset 事件驱动 */
  edit: (sessionId: string, entryId: string, payload: EditMessagePayload) => Promise<boolean>;
  /** 中断当前生成 */
  interrupt: (sessionId: string) => Promise<void>;
  /** 手动压缩上下文；进度走 compaction_* 事件 */
  compact: (sessionId: string, instructions?: string) => Promise<void>;
  /** 压缩被正常拒绝的提示已展示：清掉标记，避免重连或重渲染时重复弹 */
  ackCompactionNotice: (sessionId: string) => void;
  /** 忽略本次计划的决策表单；表单收起由 transcript_reset 事件驱动 */
  ignorePlan: (sessionId: string) => Promise<void>;
  /** 批准计划：服务端注入开工指令并起一轮；模式由调用方先切回 build */
  approvePlan: (sessionId: string) => Promise<void>;
};

type MessagesDeps = {
  apis: Apis;
  events: EventStream;
};

export const createMessagesStore = (deps: MessagesDeps): MessagesStore => {
  const engines = new Map<string, Engine>();
  const emptyStore = createStore(EMPTY_STATE);
  let connectedOnce = false;

  const ensure = (sessionId: string): Engine => {
    const existing = engines.get(sessionId);
    if (existing) return existing;
    const engine = createEngine();
    engines.set(sessionId, engine);
    return engine;
  };

  /**
   * 取快照并接续。服务端把投影与快照序号放在同一次同步读取里返回，
   * 所以「丢弃 seq <= 快照序号的缓冲帧、应用其余帧」即可无缝衔接。
   */
  const hydrate = async (sessionId: string, engine: Engine): Promise<void> => {
    const token = engine.token + 1;
    engine.token = token;
    engine.hydrating = true;
    engine.buffer = [];
    patch(engine, { loadingHistory: true });

    try {
      const snapshot = await deps.apis.messages.list(sessionId);
      if (token !== engine.token) return;

      // 位置对齐地沿用旧条目的 uid：首条消息受理后会用权威条目替掉乐观消息，而重连时的重取快照
      // 是同一批消息的权威版本。uid 一丢，界面行的 key 就变，整行会被卸载重建（看得见地闪一下）
      //
      // 只搬运乐观条目的 uid：服务端条目一律用自己的条目 id（天然唯一且跨快照稳定）。否则插入一条
      // 记录（审批、压缩摘要）就会把后面的 uid 整体错位，插入点那一条还会与插入项拿到同一个 uid
      const previous = engine.store.getState();
      // 嵌套进度先以快照为准：快照里还在跑的保留已归并的内容，本地多出来的（断流期间错过了
      // `subagent_end`）收敛为已结束；映射也一并重建，免得旧子会话的帧再归到已收敛的卡片上
      const runningSubagents: SubagentStreams = {};
      for (const item of snapshot.subagents) {
        runningSubagents[item.toolCallId] = {
          sessionId: item.sessionId,
          description: item.description,
          items: previous.subagents[item.toolCallId]?.items ?? [],
          done: false,
          isError: false,
        };
      }
      for (const [toolCallId, stream] of Object.entries(previous.subagents)) {
        if (runningSubagents[toolCallId]) continue;
        runningSubagents[toolCallId] = { ...stream, items: settle(stream.items), done: true };
      }
      engine.childToolCalls.clear();
      for (const item of snapshot.subagents) {
        if (item.sessionId) engine.childToolCalls.set(item.sessionId, item.toolCallId);
      }

      patch(engine, {
        items: snapshot.messages.map((message, index) => {
          const inherited = previous.items[index]?.uid;
          return {
            ...message,
            live: message.id === snapshot.liveMessageId,
            uid: isLiveUid(inherited) ? inherited : message.id,
          };
        }),
        running: snapshot.running,
        subagents: runningSubagents,
        // 服务清单是全量运行态：快照里没有的即已停止，直接以快照为准
        services: asServices(snapshot.services),
        // 快照不携带压缩进度、压缩结果提示与阶段：压缩中或重连后收到快照时只能退回统一的「工作中」提示
        compacting: false,
        compactionNotice: null,
        phase: null,
        pending: false,
        error: null,
      });

      const buffered = engine.buffer;
      engine.buffer = [];
      engine.hydrating = false;
      engine.hydrated = true;
      for (const frame of buffered) {
        if (frame.seq <= snapshot.seq) continue;
        applyFrame(engine, frame);
      }
    } catch (error) {
      if (token === engine.token) {
        patch(engine, { error: asApiError(error) });
      }
    } finally {
      if (token === engine.token) {
        engine.hydrating = false;
        patch(engine, { loadingHistory: false });
      }
    }
  };

  /** 收到会话事件：找到对应引擎，未激活的历史帧丢弃；子会话帧归入父引擎 */
  const routeFrame = (frame: ServerEventPayload): void => {
    const engine = engines.get(frame.sessionId);
    if (!engine) {
      for (const candidate of engines.values()) {
        const toolCallId = candidate.childToolCalls.get(frame.sessionId);
        if (!toolCallId) continue;
        // 快照对嵌套进度不做重建，取快照期间直接丢弃
        if (candidate.hydrating) return;
        applyChildFrame(candidate, toolCallId, frame);
        return;
      }
      return;
    }

    // 活动分支变了：本地历史作废，重新取快照（token 守卫会作废在途的旧快照）
    if (frame.type === "transcript_reset") {
      void hydrate(frame.sessionId, engine);
      return;
    }
    if (engine.hydrating) {
      engine.buffer.push(frame);
      return;
    }
    applyFrame(engine, frame);
  };

  deps.events.onEvent((frame) => {
    if (frame.type === "error") {
      // 错误帧是一轮的结束信号：「压缩中」也要一并清——留下它会毒到下一轮，
      // 尾部提示会把普通生成错报成「正在压缩上下文」；阶段同理，它描述的也是上一轮
      const error = toApiError(frame);
      if (frame.sessionId) {
        const engine = engines.get(frame.sessionId);
        if (!engine) return;
        patch(engine, { running: false, pending: false, compacting: false, phase: null, error });
        return;
      }
      for (const engine of engines.values()) patch(engine, { phase: null, error });
      return;
    }

    // 会话帧之外的全局控制帧（config_changed / mcp_changed）不归本 store 管
    if (!("sessionId" in frame)) return;
    routeFrame(frame);
  });

  // 只有「重连」才需要重新取快照补齐缺口；首次连接与挂载/激活时的 hydration 重合
  deps.events.onConnected(() => {
    if (!connectedOnce) {
      connectedOnce = true;
      return;
    }
    for (const [sessionId, engine] of engines) {
      // 上次没取成功的（error 非空）也一并补上
      if (engine.hydrated || engine.store.getState().error !== null)
        void hydrate(sessionId, engine);
    }
  });

  return {
    get: (sessionId) => (sessionId ? ensure(sessionId).store : emptyStore),

    activate(sessionId) {
      if (!sessionId) return;
      const engine = ensure(sessionId);
      if (!engine.hydrated && !engine.hydrating) void hydrate(sessionId, engine);
    },

    seed(sessionId) {
      const engine = ensure(sessionId);
      engine.token += 1;
      engine.hydrated = true;
      engine.hydrating = false;
      engine.buffer = [];
    },

    refresh(sessionId) {
      void hydrate(sessionId, ensure(sessionId));
    },

    async refreshServices(sessionId) {
      const engine = ensure(sessionId);
      const snapshot = await deps.apis.messages.services(sessionId);
      patch(engine, { services: asServices(snapshot.services) });
    },

    async send(sessionId, payload) {
      const engine = ensure(sessionId);
      patch(engine, { error: null });
      const optimistic = appendUserItem(engine.store.getState().items, optimisticBlocks(payload));
      // 立刻给出反馈：首个 token 都算在这段等待里；阶段同时起表，界面才能把「等模型响应」那一段报出来
      patch(engine, {
        items: optimistic.items,
        pending: true,
        phase: createPhase(Date.now()),
      });

      try {
        await deps.apis.messages.prompt({
          sessionId,
          text: payload.text,
          ...(payload.command ? { command: payload.command } : {}),
          ...(payload.skills && payload.skills.length > 0 ? { skills: payload.skills } : {}),
          ...(payload.contexts.length > 0 ? { contexts: payload.contexts } : {}),
          ...(payload.attachments.length > 0
            ? { attachments: payload.attachments.map((attachment) => ({ id: attachment.id })) }
            : {}),
        });
        return true;
      } catch (error) {
        // 没投出去就别在消息区留一条发不出去的消息（调用方会把原文还回输入框）
        patch(engine, {
          items: removeUserItem(engine.store.getState().items, optimistic.id),
          error: asApiError(error),
          pending: false,
        });
        return false;
      }
    },

    async edit(sessionId, entryId, payload) {
      const engine = ensure(sessionId);
      patch(engine, { error: null });
      try {
        await deps.apis.messages.edit({ sessionId, entryId, ...payload });
        return true;
      } catch (error) {
        patch(engine, { error: asApiError(error) });
        return false;
      }
    },

    async interrupt(sessionId) {
      try {
        await deps.apis.messages.interrupt(sessionId);
      } catch {
        // 忽略：中断失败时服务端仍会继续上报事件
      }
    },

    async compact(sessionId, instructions) {
      const engine = ensure(sessionId);
      // 重新发起压缩时一并清掉上一次的压缩结果提示，避免旧标记残留
      patch(engine, { error: null, compactionNotice: null });
      try {
        await deps.apis.messages.compact({
          sessionId,
          ...(instructions ? { instructions } : {}),
        });
      } catch (error) {
        const apiError = asApiError(error);
        // 会话还在跑这一轮是预期情况（等它结束再压即可）：走轻提示，不占错误横幅
        if (apiError.code === ERROR_CODES.sessionBusy) {
          patch(engine, { compactionNotice: { kind: "busy" } });
          return;
        }
        patch(engine, { error: apiError });
      }
    },

    ackCompactionNotice(sessionId) {
      patch(ensure(sessionId), { compactionNotice: null });
    },

    async ignorePlan(sessionId) {
      const engine = ensure(sessionId);
      patch(engine, { error: null });
      try {
        await deps.apis.messages.ignorePlan(sessionId);
      } catch (error) {
        patch(engine, { error: asApiError(error) });
      }
    },

    async approvePlan(sessionId) {
      const engine = ensure(sessionId);
      patch(engine, { error: null });
      try {
        await deps.apis.messages.approvePlan(sessionId);
      } catch (error) {
        patch(engine, { error: asApiError(error) });
      }
    },
  };
};
