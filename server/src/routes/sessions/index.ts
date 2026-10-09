/** /api/v1/sessions：会话的列表 / 新建 / 详情 / 更新 / 归档 / 分叉 */
import { rmSync } from "node:fs";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  ERROR_CODES,
  MODE_RECORD_CUSTOM_TYPE,
  type SessionArchiveResponse,
  type SessionCreateInput,
  type SessionForkInput,
  type SessionInfoResponse,
  type SessionListInput,
  type SessionListResponse,
  type SessionSummary,
  type SessionUpdateInput,
  sessionCreateInputSchema,
  sessionForkInputSchema,
  sessionIdInputSchema,
  sessionListInputSchema,
  sessionUpdateInputSchema,
  type ThinkingLevel,
} from "@ucode/contracts";
import { Hono } from "hono";
import type { Services } from "../../app";
import {
  draftSessionSummary,
  type SessionRuntimeState,
  sessionInfoToDTO,
} from "../../core/serialize";
import { assertModel, createSession } from "../../core/session";
import { managerToIndex, recordToInfo } from "../../core/session-index";
import {
  describeSessionSummary,
  resolvedThinkingLevelOf,
  type SessionSummarySources,
} from "../../core/session-summary";
import { overrideOf } from "../../db/session-repository";
import { env } from "../../env";
import {
  type AgentRegistry,
  hasPrimaryMode,
  loadAgentRegistry,
  recommendedThinkingLevelOf,
  resolveThinkingLevel,
} from "../../harness/agents";
import { createForkedSessionFile, resolveForkSource } from "../../harness/fork";
import { resolveSessionCwd } from "../../harness/session-config";
import { workspaceDirOf } from "../../harness/workspace";
import { AppError, ok } from "../../lib/response";
import { jsonBody } from "../../lib/validate";
import { resolveTargetPath } from "../../utils/path";

/** primary 模式必须存在（内置或已注册的自定义角色）；否则新建 / 切换会落到未知 slug 上 */
const assertPrimaryMode = (cwd: string, mode: string): void => {
  const registry = loadAgentRegistry({ cwd, appHome: env.homeDir });
  if (!hasPrimaryMode(mode, registry)) {
    throw new AppError(ERROR_CODES.invalidRequest, `未知的会话模式：${mode}`, 400, undefined, {
      mode,
    });
  }
};

const defaultModelOf = (services: Services): string | null =>
  services.runtime.getStatus().defaultModel;

/**
 * 会话摘要：已落盘读行里的缓存，否则给草稿视图（只有覆盖值可展示）。
 * 行不存在才 404——草稿会话（尚未落盘）也有行，据此把「无行」与「有行未落盘」区分开，
 * 客户端才能把 URL 里已消失的会话清掉而不是渲染成空会话。
 */
const describeSession = (services: Services, sessionId: string): SessionInfoResponse => {
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  const session = describeSessionSummary(summarySources(services), sessionId);
  if (!session) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  // 池内会话直接读内存条目，避免每次 info 都重解析整份会话文件
  const live = services.pool.get(sessionId);
  const usage = services.usage.usageOf(record, { live });
  const contextUsage = services.usage.contextUsageOf(record, { live });
  const goal = services.goals.view(record, live);

  return { session, usage, contextUsage, goal };
};

/** 事件下发与详情共用同一套摘要口径 */
const summarySources = (services: Services): SessionSummarySources => {
  // 列表一次要出上百行摘要：角色注册表按 cwd 各加载一次，别为每行扫一遍角色目录
  const registries = new Map<string, AgentRegistry>();
  const registryOf = (cwd: string): AgentRegistry => {
    const cached = registries.get(cwd);
    if (cached) return cached;
    const loaded = loadAgentRegistry({ cwd, appHome: env.homeDir });
    registries.set(cwd, loaded);
    return loaded;
  };

  return {
    repository: services.sessions,
    isActive: (sessionId) => services.pool.isActive(sessionId),
    statusOf: (sessionId) => services.pool.statusOf(sessionId),
    defaultModel: () => defaultModelOf(services),
    effectiveThinkingLevel: (sessionId) => services.pool.get(sessionId)?.thinkingLevel ?? null,
    recommendedThinkingLevel: (record) =>
      recommendedThinkingLevelOf(record.mode, registryOf(resolveSessionCwd(record))),
  };
};

/** 列表行的运行态：活跃布尔与细分状态同源，免得两处口径分叉 */
const runtimeState = (services: Services, sessionId: string): SessionRuntimeState => ({
  running: services.pool.isActive(sessionId),
  status: services.pool.statusOf(sessionId),
});

const listSessions = (services: Services, query: SessionListInput): SessionListResponse => {
  const sources = summarySources(services);
  const model = sources.defaultModel();
  const { records, total } = services.sessions.search(query);

  // 已落盘行读行里的缓存；草稿行只有覆盖值可展示，用行里的真实时间保持排序口径一致
  const sessions = records.map((record) => {
    const runtime = runtimeState(services, record.id);
    const resolvedThinkingLevel = resolvedThinkingLevelOf(sources, record);
    return record.sourcePath
      ? sessionInfoToDTO(
          recordToInfo(record),
          overrideOf(record),
          model,
          resolvedThinkingLevel,
          runtime,
          record.childCount,
        )
      : draftSessionSummary(
          record.id,
          overrideOf(record),
          model,
          resolvedThinkingLevel,
          workspaceDirOf(record.id),
          runtime,
          record.childCount,
          { createdAt: record.createdAt, updatedAt: record.updatedAt },
        );
  });

  return { sessions, total };
};

/**
 * 新建只返回 id 与草稿视图：会话文件在首次产生 assistant 回复时才落盘。
 */
const createSessionRoute = (services: Services, input: SessionCreateInput): SessionSummary => {
  if (!services.runtime.getStatus().configured) {
    throw new AppError(
      ERROR_CODES.modelNotConfigured,
      "尚未配置模型，请先在设置里添加 provider",
      409,
    );
  }
  if (input.model) assertModel(services, input.model);
  if (input.mode) {
    assertPrimaryMode(input.cwd ? resolveTargetPath(input.cwd) : env.workspacesDir, input.mode);
  }

  const sessionId = createSession(services, input);

  const summary = describeSessionSummary(summarySources(services), sessionId);
  if (!summary) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  services.events.emitSessionCreated(sessionId, summary);
  return summary;
};

/** 名称 / 模型变更同时追加到会话文件，供 pi 重放 */
const appendTranscriptPatch = (
  sourcePath: string,
  cwd: string,
  patch: SessionUpdateInput,
  /** 档位偏好解开的实际档位（`auto` 按模式推荐值）；null 表示本次没改档位 */
  resolvedThinkingLevel: ThinkingLevel | null,
  /** 池里那个活会话的 manager：内存里的叶子才是权威，另开一句柄追加会让新条目挂在旧父节点上 */
  live?: SessionManager,
): SessionManager => {
  const manager = live ?? SessionManager.open(sourcePath, env.sessionsDir, cwd);
  if (patch.name) manager.appendSessionInfo(patch.name);
  if (patch.model) {
    const separator = patch.model.indexOf("/");
    manager.appendModelChange(patch.model.slice(0, separator), patch.model.slice(separator + 1));
  }
  // 文件里记的是实际档位：pi 按这些条目标每轮页脚的档位，记 `auto` 就标不出来了
  if (resolvedThinkingLevel) manager.appendThinkingLevelChange(resolvedThinkingLevel);
  // 模式与权限档位决定每轮的工具集与审批口径：换了什么、什么时候换的，只有文件里查得到
  if (patch.mode || patch.permissionMode) {
    manager.appendCustomEntry(MODE_RECORD_CUSTOM_TYPE, {
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.permissionMode ? { permissionMode: patch.permissionMode } : {}),
      at: new Date().toISOString(),
    });
  }
  return manager;
};

const updateSession = (services: Services, patch: SessionUpdateInput): SessionSummary => {
  if (patch.model) assertModel(services, patch.model);
  if (
    (patch.model || patch.thinkingLevel || patch.mode || patch.permissionMode) &&
    services.pool.isActive(patch.sessionId)
  ) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  const record = services.sessions.find(patch.sessionId);
  // 仓储的 set 是 upsert，不拦的话会给不存在的会话凭空建一行
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${patch.sessionId}`, 404, undefined, {
      path: patch.sessionId,
    });
  }
  // 目标只跑在 build 上：切走执行模式即暂停，避免只读模式仍在自动续跑
  if (patch.mode) {
    assertPrimaryMode(resolveSessionCwd(record), patch.mode);
    if (patch.mode !== "build") {
      services.goals.pause(record, "mode", services.pool.get(patch.sessionId));
    }
  }
  if (record.sourcePath) {
    // 只有名称 / 模型 / 档位 / 模式需要追加到会话文件；置顶等元数据不落文件
    if (patch.name || patch.model || patch.thinkingLevel || patch.mode || patch.permissionMode) {
      const cwd = resolveSessionCwd(record);
      // pi 按 `thinking_level_change` 条目标每轮页脚的档位，所以文件里记解析后的实际档位，不记 `auto`
      // 档位跟随模式，同一次请求里还改了模式时按新模式解析——按旧模式解出来的档位与
      // 重建后的会话（用新模式的推荐值）不一致，文件里的记录会撒谎
      const resolved = patch.thinkingLevel
        ? resolveThinkingLevel(
            patch.thinkingLevel,
            patch.mode ?? record.mode,
            loadAgentRegistry({ cwd, appHome: env.homeDir }),
          )
        : null;
      const manager = appendTranscriptPatch(
        record.sourcePath,
        cwd,
        patch,
        resolved,
        services.pool.get(patch.sessionId)?.sessionManager,
      );
      const index = managerToIndex(manager);
      if (index) services.sessions.refresh(patch.sessionId, index);
    }
  }

  services.sessions.set(patch.sessionId, {
    ...(patch.name ? { name: patch.name } : {}),
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.thinkingLevel ? { thinkingLevel: patch.thinkingLevel } : {}),
    ...(patch.mode ? { mode: patch.mode } : {}),
    ...(patch.permissionMode ? { permissionMode: patch.permissionMode } : {}),
  });

  // 置顶是应用侧元数据：只写 pinned_at，不改 updated_at、不重建会话
  if (patch.pinned !== undefined) {
    services.sessions.setPinned(patch.sessionId, patch.pinned ? new Date().toISOString() : null);
  }

  // 换模型 / 换 thinking / 换模式 / 换权限档位需要重建会话实例才会生效，历史留在盘上
  if (patch.model || patch.thinkingLevel || patch.mode || patch.permissionMode) {
    services.pool.dispose(patch.sessionId);
  }
  // 模式变更会在转录里多一条细线，转录已变、客户端手上的那份作废
  if (patch.mode || patch.permissionMode) {
    services.events.emitFrame(patch.sessionId, "transcript_reset", { fromEntryId: "" });
  }

  // 与 /create 一致，返回扁平摘要（/info 才是 {session}）
  const info = describeSession(services, patch.sessionId);
  // 带上占用与窗口：改模型 / 模式会换掉生效窗口，不重发的话客户端会继续按旧窗口算百分比
  services.events.emitSessionUpdated(patch.sessionId, info.session, info.usage, info.contextUsage);
  return info.session;
};

/** `/read`：标记会话已读（写上次打开时间），用于侧栏未读点消失 */
const readSession = (services: Services, sessionId: string): SessionSummary => {
  const record = services.sessions.find(sessionId);
  if (!record) {
    throw new AppError(ERROR_CODES.notFound, `会话不存在：${sessionId}`, 404, undefined, {
      path: sessionId,
    });
  }
  services.sessions.setLastRead(sessionId, new Date().toISOString());
  const summary = describeSession(services, sessionId).session;
  services.events.emitSessionUpdated(sessionId, summary);
  return summary;
};

/** 归档（软删）：只写 `deleted_at`，行、JSONL 与工作区目录都保留；子会话随父级联归档 */
const archiveSession = (services: Services, sessionId: string): SessionArchiveResponse => {
  // 子会话只能查看、不会独立在跑，但归档是破坏性动作，仍对整棵子树做一次忙碌校验
  const targets = [sessionId, ...services.sessions.descendantIds(sessionId)];
  if (targets.some((id) => services.pool.isActive(id))) {
    throw new AppError(ERROR_CODES.sessionBusy, "会话正在生成，请先中断", 409);
  }

  for (const id of targets) {
    services.pool.dispose(id);
    // 会话归档后，挂起的审批与「本会话恒允」都失去意义；目标状态一并清掉
    services.interactions.forget(id);
    services.permissions.clear(id);
    services.sessions.setGoal(id, null);
    services.sessions.archive(id);
    // 先广播归档再清序号：客户端只按 type 处理，seq 不参与列表口径
    services.events.emitSessionArchived(id);
    services.events.remove(id);
  }

  return { archived: true, sessionId };
};

/**
 * 会话分叉：从某条消息（缺省当前叶子）抽出新会话，原会话不动。
 * 子智能体会话只读且没有独立模式语义，不允许作为分叉源。
 */
const forkSession = (services: Services, input: SessionForkInput): SessionSummary => {
  const source = resolveForkSource(
    input.sessionId,
    services.sessions.find(input.sessionId),
    services.pool.isActive(input.sessionId),
  );

  // 分叉会话与源共用工作目录：新会话文件 header 与 DB 行都用源解析后的 cwd
  const cwd = resolveSessionCwd(source);
  const forked = createForkedSessionFile({
    sourcePath: source.sourcePath,
    cwd,
    ...(input.fromEntryId ? { fromEntryId: input.fromEntryId } : {}),
  });

  const model = defaultModelOf(services);
  const override = overrideOf(source);
  try {
    services.sessions.createForked(forked.id, {
      forkedFromId: source.id,
      cwd,
      name: input.name ?? (source.name ? `${source.name} · 分叉` : null),
      mode: source.mode,
      // 模型继承源会话的生效值，档位继承偏好：`auto` 保持 `auto`，而 mode 也继承，解析结果与源一致
      model: override.model ?? model ?? undefined,
      ...(override.thinkingLevel ? { thinkingLevel: override.thinkingLevel } : {}),
    });
  } catch (error) {
    // 行没落上：刚写出的分叉文件没有主，清掉避免留孤儿
    rmSync(forked.sourcePath, { force: true });
    throw error;
  }

  const index = managerToIndex(forked.manager);
  if (index) services.sessions.refresh(forked.id, index);

  const summary = describeSession(services, forked.id).session;
  services.events.emitSessionCreated(forked.id, summary);
  return summary;
};

export const createSessionsRoute = (services: Services) => {
  const router = new Hono();

  router.post("/list", jsonBody(sessionListInputSchema), (c) =>
    c.json(ok(listSessions(services, c.req.valid("json")))),
  );
  router.post("/create", jsonBody(sessionCreateInputSchema), (c) =>
    c.json(ok(createSessionRoute(services, c.req.valid("json")))),
  );
  router.post("/info", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(describeSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/update", jsonBody(sessionUpdateInputSchema), (c) =>
    c.json(ok(updateSession(services, c.req.valid("json")))),
  );
  router.post("/archive", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(archiveSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/read", jsonBody(sessionIdInputSchema), (c) =>
    c.json(ok(readSession(services, c.req.valid("json").sessionId))),
  );
  router.post("/fork", jsonBody(sessionForkInputSchema), (c) =>
    c.json(ok(forkSession(services, c.req.valid("json")))),
  );

  return router;
};
