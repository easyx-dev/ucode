/**
 * 中继隧道客户端：向中继建立出站长连接，把回灌的请求转给本机服务。
 *
 * 一台设备对应一条隧道——中继侧同一设备只保留一条活连接（新连接接管旧的），所以这里不做连接池，
 * 配置一变就整体重连。心跳只回不应：中继每 `HEARTBEAT_INTERVAL_MS` 发 ping、超过
 * `HEARTBEAT_TIMEOUT_MS` 收不到 pong 就断开，判死只在中继那一侧（两边都判会互相打断、把重连搅成抖动）。
 */
import { hostname, platform } from "node:os";

import {
  type ControlFrame,
  chunkPayload,
  DATA_FRAME_KINDS,
  type DataFrameKind,
  decodeControlFrame,
  decodeDataFrame,
  encodeControlFrame,
  encodeDataFrame,
  MAX_CONCURRENT_STREAMS,
  PROTOCOL_VERSION,
  type RequestFrame,
  TUNNEL_ERROR_CODES,
  TUNNEL_PATH,
} from "@ucode/hub-protocol";
import { WebSocket } from "ws";

import {
  HUB_HANDSHAKE_TIMEOUT_MS,
  HUB_RECONNECT_BASE_MS,
  HUB_RECONNECT_JITTER_RATIO,
  HUB_RECONNECT_MAX_MS,
  HUB_UPGRADE_REJECT_CLOSE_CODES,
} from "../../constants/hub";
import { logger } from "../../platform/logger";
import { serviceVersion } from "../../platform/version";
import { forwardToLocal, HUB_FORWARD_ERROR_CODES, resolveLocalTarget } from "./forward";
import { getHubConfig, type HubConfig, setHubRuntimeState, subscribeHubConfig } from "./state";
import { forwardUpgradeToLocal, toSocketBytes } from "./ws-forward";

/** 隧道自身的两段：握手中（hello 已发、还没等到 welcome）、已上线（中继已登记这条隧道） */
export type HubTunnelPhase = "handshake" | "ready";

/** 一条入站控制帧该走哪条分支；`ignore` 表示与当前阶段无关或认不出 */
export type HubInboundAction =
  | "welcome"
  | "reject"
  | "ping"
  | "pong"
  | "request"
  | "requestEnd"
  | "close"
  | "abort"
  | "ignore";

/**
 * 中继地址 → 隧道端点。http→ws / https→wss，主机、端口与地址里的路径前缀都保留
 * （中继挂在反代的子路径下时用得上），端点固定是 `TUNNEL_PATH`。
 */
export const toTunnelUrl = (hubUrl: string): string | null => {
  let base: URL;
  try {
    base = new URL(hubUrl);
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;

  const scheme = base.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${base.host}${base.pathname.replace(/\/+$/, "")}${TUNNEL_PATH}`;
};

/**
 * 重连退避：第 n 次（从 0 起）延迟 = base × 2^n，封顶 max，再乘 1±jitter 的抖动。
 * 抖动是必要的——中继重启时所有客户端会在同一刻回连，整齐地涌上去只会让它再崩一次。
 */
export const reconnectDelayMs = (attempt: number, random: () => number = Math.random): number => {
  const capped = Math.min(HUB_RECONNECT_BASE_MS * 2 ** Math.max(attempt, 0), HUB_RECONNECT_MAX_MS);
  const jitter = 1 - HUB_RECONNECT_JITTER_RATIO + random() * HUB_RECONNECT_JITTER_RATIO * 2;
  return Math.round(capped * jitter);
};

/**
 * 入站控制帧的分发决策。
 * 握手完成前只认 `welcome` / `reject`：此时中继还没把这条隧道登记为可用，请求帧与数据帧无处可去；
 * 上线后握手三件套再来一遍没有意义，`response` / `responseEnd` / `error` 只应由本侧发出，一并忽略。
 */
export const classifyInbound = (
  frame: ControlFrame | null,
  phase: HubTunnelPhase,
): HubInboundAction => {
  if (!frame) return "ignore";

  if (phase === "handshake") {
    if (frame.t === "welcome") return "welcome";
    if (frame.t === "reject") return "reject";
    return "ignore";
  }

  switch (frame.t) {
    case "ping":
      return "ping";
    case "pong":
      return "pong";
    case "request":
      return "request";
    case "requestEnd":
      return "requestEnd";
    case "close":
      return "close";
    case "abort":
      return "abort";
    default:
      return "ignore";
  }
};

/** 未连上的原因（运行态展示用）：分「没开」「没地址」「没登记设备」三种，界面据此引导下一步 */
const describeMissing = (config: HubConfig): string | null => {
  if (!config.enabled) return null;
  if (!config.url) return "已开启中继但没有可用的中继地址";
  if (!config.deviceToken) return "尚未在中继上登记本机设备";
  return null;
};

/**
 * 在飞流的收尾口径：普通 HTTP 转发与 WebSocket 升级流都满足，后者多一个带关闭码的 `close`
 * （hub 主动关闭这条流时用）。
 */
type TunnelStreamHandle = {
  /** `text` 表示这一块是 WebSocket 文本帧的内容（普通 HTTP 流转发时一定缺省） */
  writeBody(chunk: Uint8Array, text?: boolean): void | Promise<void>;
  endBody(): void;
  abort(reason?: string): void;
  close?(code: number, reason?: string): void;
};

type TunnelSession = {
  socket: WebSocket;
  /** 隧道端点，日志里要能看出连的是哪台中继 */
  endpoint: string;
  /** 配置里的设备 id（welcome 帧给的更权威，仅用于日志） */
  deviceId: string | null;
  phase: HubTunnelPhase;
  handshakeTimer: NodeJS.Timeout | null;
  /** 在飞的转发：`abort` 帧与连接收尾按流号取消上游 */
  streams: Map<number, TunnelStreamHandle>;
  /** 收尾只做一次：close 事件与主动断开都会走到 `settleSession` */
  settled: boolean;
  /** 本次会话为什么没连上 / 为什么断：写进运行态的 `lastError`，供界面直接显示 */
  lastFailure: string | null;
  /** 入站处理链：同一连接的帧按到达顺序生效（请求体的背压靠它串行） */
  inbound: Promise<void>;
};

export type HubTunnel = {
  /** 按当前配置连接；未启用 / 未登记设备时只更新运行态，不重连 */
  start(): void;
  /** 断开并停止重连（进程退出） */
  stop(): void;
  /** 按现行配置重建隧道（配置变更由订阅自动触发，也可手动调） */
  restart(): void;
  /** 当前是否持有连接（含握手中） */
  isRunning(): boolean;
};

export const createHubTunnel = (): HubTunnel => {
  let started = false;
  /** 被中继拒绝后停止重连：令牌失效这类原因重连也没用，等用户重新登录（restart 会清掉它） */
  let halted = false;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let session: TunnelSession | null = null;
  let unsubscribeConfig: (() => void) | null = null;

  const reasonOf = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  /** 控制帧直发；连接已断时发送会抛，但那不该冒泡到转发回调里 */
  const sendControl = (target: TunnelSession, frame: ControlFrame): void => {
    try {
      target.socket.send(encodeControlFrame(frame));
    } catch (error) {
      logger.debug({ error: reasonOf(error) }, "隧道控制帧发送失败（连接可能已关闭）");
    }
  };

  /** 送一块响应体；返回的 promise 在帧真正写出去后 resolve，转发侧据此背压 */
  const sendBody = (
    target: TunnelSession,
    streamId: number,
    chunk: Uint8Array,
    kind: DataFrameKind,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      target.socket.send(encodeDataFrame({ kind, streamId, payload: chunk }), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

  /**
   * 响应体逐块发出：一块可能超过单帧上限（本地大响应），按协议的切块口径拆开后顺序发。
   * `text` 表示这是 WebSocket 文本帧的内容，回传时要保住这个类型（终端下行靠它）。
   */
  const sendResponseBody = async (
    target: TunnelSession,
    streamId: number,
    chunk: Uint8Array,
    text = false,
  ): Promise<void> => {
    const kind = text ? DATA_FRAME_KINDS.responseText : DATA_FRAME_KINDS.responseBody;
    for (const part of chunkPayload(chunk)) {
      await sendBody(target, streamId, part, kind);
    }
  };

  const settleWelcome = (target: TunnelSession, deviceId: string): void => {
    if (target.phase === "ready") return;
    target.phase = "ready";
    if (target.handshakeTimer) {
      clearTimeout(target.handshakeTimer);
      target.handshakeTimer = null;
    }
    attempt = 0;
    setHubRuntimeState({
      connected: true,
      connectedAt: new Date().toISOString(),
      lastError: null,
      reconnectAttempt: 0,
    });
    logger.info({ endpoint: target.endpoint, deviceId }, "中继隧道已上线");
  };

  /** 握手被拒：记下原因并停止重连——中继不接受这份凭证时，重连只是白撞 */
  const settleReject = (target: TunnelSession, message: string): void => {
    halted = true;
    setHubRuntimeState({
      connected: false,
      lastError: `中继拒绝隧道握手：${message}`,
      reconnectAttempt: 0,
    });
    logger.warn({ endpoint: target.endpoint, message }, "中继拒绝隧道握手，停止重连直到重新登录");
    target.socket.terminate();
  };

  /** 一条流：转发到本机服务，把结果编码成帧回给中继 */
  const openStream = (target: TunnelSession, frame: RequestFrame): void => {
    if (target.streams.has(frame.id)) {
      logger.debug({ streamId: frame.id }, "流号重复，忽略该请求");
      return;
    }
    if (target.streams.size >= MAX_CONCURRENT_STREAMS) {
      sendControl(target, {
        t: "error",
        id: frame.id,
        code: TUNNEL_ERROR_CODES.tunnelBusy,
        message: "本机在飞的转发已达上限",
      });
      return;
    }

    const local = resolveLocalTarget();
    if (!local) {
      sendControl(target, {
        t: "error",
        id: frame.id,
        code: HUB_FORWARD_ERROR_CODES.localUnavailable,
        message: "读不到本机服务地址或凭证",
      });
      return;
    }

    // 升级流：本机侧是一条 WebSocket，双向泵字节，关闭码原样带回去
    if (frame.upgrade) {
      // 建连就失败（地址拼不出来、连接同步抛）时 onError 已经回过错误帧，
      // 这时不能把一个空壳句柄留在表里占着流号——它再也不会被收尾
      let failed = false;
      const handle = forwardUpgradeToLocal(
        { frame, target: local },
        {
          onUpgrade: () =>
            sendControl(target, { t: "response", id: frame.id, status: 101, headers: {} }),
          onData: (chunk, isText) => sendResponseBody(target, frame.id, chunk, isText),
          onClose: (code, reason) => {
            target.streams.delete(frame.id);
            sendControl(target, { t: "close", id: frame.id, code, reason });
          },
          onError: (failure) => {
            failed = true;
            target.streams.delete(frame.id);
            if (failure.code === HUB_FORWARD_ERROR_CODES.aborted) return;
            // 本机用普通 HTTP 拒绝了升级：状态码映射成关闭码回给浏览器（终端的 4401/4404 靠它区分终态），
            // 否则浏览器只看到「连接异常」，会一直重连
            const rejected = failure.httpStatus
              ? HUB_UPGRADE_REJECT_CLOSE_CODES[failure.httpStatus]
              : undefined;
            if (rejected !== undefined) {
              sendControl(target, {
                t: "close",
                id: frame.id,
                code: rejected,
                reason: "upgrade_rejected",
              });
              return;
            }
            sendControl(target, {
              t: "error",
              id: frame.id,
              code: failure.code,
              message: failure.message,
            });
          },
        },
      );
      if (!failed) target.streams.set(frame.id, handle);
      logger.debug({ streamId: frame.id, path: frame.path }, "隧道升级流已转到本机 WebSocket");
      return;
    }

    target.streams.set(
      frame.id,
      forwardToLocal(
        { frame, target: local },
        {
          onResponse: (status, headers) =>
            sendControl(target, { t: "response", id: frame.id, status, headers }),
          onData: (chunk) => sendResponseBody(target, frame.id, chunk),
          onEnd: () => {
            target.streams.delete(frame.id);
            sendControl(target, { t: "responseEnd", id: frame.id });
          },
          onError: (failure) => {
            target.streams.delete(frame.id);
            // 公网侧断开时中继早已把这条流移出登记表，回错误帧只会被丢弃
            if (failure.code === HUB_FORWARD_ERROR_CODES.aborted) return;
            sendControl(target, {
              t: "error",
              id: frame.id,
              code: failure.code,
              message: failure.message,
            });
          },
        },
      ),
    );
    logger.debug(
      { streamId: frame.id, method: frame.method, path: frame.path },
      "隧道请求已转发到本机服务",
    );
  };

  const handleInboundControl = (target: TunnelSession, frame: ControlFrame | null): void => {
    switch (classifyInbound(frame, target.phase)) {
      case "welcome":
        if (frame?.t === "welcome") settleWelcome(target, frame.deviceId);
        return;
      case "reject":
        if (frame?.t === "reject") settleReject(target, frame.message);
        return;
      case "ping":
        sendControl(target, { t: "pong" });
        return;
      case "pong":
        return;
      case "request":
        if (frame?.t === "request") openStream(target, frame);
        return;
      case "requestEnd":
        if (frame?.t === "requestEnd") target.streams.get(frame.id)?.endBody();
        return;
      case "close": {
        if (frame?.t !== "close") return;
        const handle = target.streams.get(frame.id);
        if (!handle) return;
        target.streams.delete(frame.id);
        handle.close?.(frame.code, frame.reason);
        return;
      }
      case "abort": {
        if (frame?.t !== "abort") return;
        const handle = target.streams.get(frame.id);
        target.streams.delete(frame.id);
        handle?.abort(frame.reason ?? "公网侧已断开");
        return;
      }
      case "ignore":
        logger.debug(
          { endpoint: target.endpoint, type: frame?.t ?? null, phase: target.phase },
          "隧道收到无关或无法解析的控制帧，已忽略",
        );
        return;
    }
  };

  const handleInboundData = (target: TunnelSession, bytes: Uint8Array): void | Promise<void> => {
    const frame = decodeDataFrame(bytes);
    if (!frame) {
      logger.debug({ endpoint: target.endpoint }, "隧道收到无法解析的数据帧");
      return;
    }
    if (target.phase !== "ready") return;
    if (
      frame.kind !== DATA_FRAME_KINDS.requestBody &&
      frame.kind !== DATA_FRAME_KINDS.requestText
    ) {
      logger.debug(
        { streamId: frame.streamId, kind: frame.kind },
        "隧道收到非请求体的数据帧，已忽略",
      );
      return;
    }

    const handle = target.streams.get(frame.streamId);
    if (!handle) {
      logger.debug({ streamId: frame.streamId }, "数据帧对应的流已收尾，已忽略");
      return;
    }
    // 上游读得慢时返回 promise：入站链会等它，等于把背压一路传回中继
    return handle.writeBody(frame.payload, frame.kind === DATA_FRAME_KINDS.requestText);
  };

  /**
   * 连接收尾：取消在飞转发、清计时器、更新运行态，并按 `reconnect` 决定要不要重连。
   * 主动换代（配置变更 / stop）传 false——下一步由调用方决定，别让重连再插一脚。
   */
  const settleSession = (
    target: TunnelSession,
    reason: string,
    reconnect: boolean,
    failure: string | null = target.lastFailure,
  ): void => {
    if (target.settled) return;
    target.settled = true;
    if (target.handshakeTimer) clearTimeout(target.handshakeTimer);
    for (const handle of target.streams.values()) handle.abort(reason);
    target.streams.clear();
    if (session === target) session = null;

    if (target.phase === "ready")
      logger.info({ endpoint: target.endpoint, reason }, "中继隧道已下线");
    else logger.debug({ endpoint: target.endpoint, reason }, "中继隧道在握手完成前断开");

    // 主动换代（stop / 改配置）传 failure=null：那不是故障，界面上保留上一次确实的原因
    setHubRuntimeState({
      connected: false,
      ...(failure ? { lastError: failure } : {}),
      reconnectAttempt: attempt,
    });
    if (reconnect) scheduleReconnect();
  };

  const scheduleReconnect = (): void => {
    if (!started || halted || reconnectTimer) return;
    const delay = reconnectDelayMs(attempt);
    attempt += 1;
    setHubRuntimeState({ reconnectAttempt: attempt });
    logger.debug({ delayMs: delay, attempt }, "中继隧道将按退避重连");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    reconnectTimer.unref();
  };

  /** 断开当前连接但不改「已启动」状态；不等关闭帧——中继见断开即注销这条隧道 */
  const dropCurrent = (reason: string): void => {
    const target = session;
    if (!target) return;
    settleSession(target, reason, false);
    target.socket.terminate();
  };

  const connect = (): void => {
    if (!started || session) return;

    const config = getHubConfig();
    const missing = describeMissing(config);
    if (missing || !config.url || !config.deviceToken) {
      setHubRuntimeState({ connected: false, lastError: missing, reconnectAttempt: attempt });
      return;
    }

    const endpoint = toTunnelUrl(config.url);
    if (!endpoint) {
      logger.warn({ url: config.url }, "中继地址不是合法的 http(s) 地址");
      setHubRuntimeState({
        connected: false,
        lastError: `中继地址不是合法的 http(s) 地址：${config.url}`,
      });
      return;
    }

    // 设备身份走握手头：中继在 HTTP 升级时就认它，认不过连 WS 都不建（令牌不进 URL，避免落进访问日志）
    const socket = new WebSocket(endpoint, {
      headers: { authorization: `Bearer ${config.deviceToken}` },
    });
    const target: TunnelSession = {
      socket,
      endpoint,
      deviceId: config.deviceId,
      phase: "handshake",
      handshakeTimer: null,
      streams: new Map(),
      settled: false,
      lastFailure: null,
      inbound: Promise.resolve(),
    };
    session = target;
    logger.debug({ endpoint, deviceId: config.deviceId }, "正在连接中继隧道");

    socket.on("open", () => {
      target.handshakeTimer = setTimeout(() => {
        logger.warn({ endpoint }, "中继隧道握手超时，断开重连");
        target.lastFailure ??= "与中继的握手超时";
        settleSession(target, "握手超时", true);
        socket.terminate();
      }, HUB_HANDSHAKE_TIMEOUT_MS);
      sendControl(target, {
        t: "hello",
        protocol: PROTOCOL_VERSION,
        clientVersion: serviceVersion,
        deviceName: hostname().slice(0, 100),
        platform: platform(),
      });
    });

    socket.on("message", (data, isBinary) => {
      target.inbound = target.inbound
        .then(() =>
          isBinary
            ? handleInboundData(target, toSocketBytes(data))
            : handleInboundControl(target, decodeControlFrame(data.toString())),
        )
        .catch((error) => {
          logger.warn(
            { endpoint, error: reasonOf(error) },
            "隧道入站帧处理失败（连接保持，交由心跳判死）",
          );
        });
    });

    socket.on("unexpected-response", (_request, response) => {
      // 升级被拒（设备令牌无效 / 已吊销）：中继不会建隧道，重连也没用，等用户重新登记
      const status = response.statusCode ?? 0;
      halted = status === 401 || status === 403;
      logger.warn({ endpoint, status }, "中继拒绝了隧道握手（HTTP 升级未通过）");
      setHubRuntimeState({
        connected: false,
        lastError: `中继拒绝隧道握手（HTTP ${status}）`,
        reconnectAttempt: 0,
      });
      response.resume();
      socket.terminate();
    });

    socket.on("error", (error) => {
      // 第一个失败原因才算原因（后面跟着的 close 只是它带出来的结果）
      target.lastFailure ??= `连接出错：${reasonOf(error)}`;
      logger.debug({ endpoint, error: reasonOf(error) }, "中继隧道连接出错（交由 close 收尾）");
    });

    socket.on("close", (code, reason) => {
      const detail = reason.length > 0 ? ` ${reason.toString()}` : "";
      target.lastFailure ??= `连接关闭（${code}${detail}）`;
      settleSession(target, `连接关闭（${code}${detail}）`, true);
    });
  };

  const restart = (): void => {
    if (!started) return;
    halted = false;
    attempt = 0;
    dropCurrent("按新配置重建隧道");
    connect();
  };

  /** 只有这几项要重连：只改了展示用的用户名时不该把隧道拆了 */
  const isTunnelConfigChanged = (next: HubConfig, previous: HubConfig): boolean =>
    next.enabled !== previous.enabled ||
    next.url !== previous.url ||
    next.deviceToken !== previous.deviceToken ||
    next.deviceId !== previous.deviceId;

  return {
    start(): void {
      if (started) return;
      started = true;
      halted = false;
      attempt = 0;
      unsubscribeConfig = subscribeHubConfig((next, previous) => {
        if (isTunnelConfigChanged(next, previous)) restart();
      });
      connect();
    },
    stop(): void {
      if (!started) return;
      started = false;
      halted = false;
      attempt = 0;
      unsubscribeConfig?.();
      unsubscribeConfig = null;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      dropCurrent("中继隧道已关闭");
      setHubRuntimeState({ connected: false, connectedAt: null, reconnectAttempt: 0 });
    },
    restart,
    isRunning: () => session !== null,
  };
};
