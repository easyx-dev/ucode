/**
 * 中继隧道编排：什么时候连、握手怎么收敛、入站帧放哪条链、断了怎么退避。
 *
 * 帧的读写与会话状态在 `session.ts`，一条流怎么转发在 `streams.ts`，端点与退避在 `endpoint.ts`；
 * 这里只做决策。三条硬约束：
 *
 * 1. **控制面不等数据面**：`ping` / `close` / `abort` 走控制链，`request` / 请求体走数据链。
 *    数据链会挂在本机上游的 drain 上，控制帧排在它后面就等于让一条慢流决定整条隧道的存活。
 * 2. **收尾后的一切入站帧都作废**：`isLive` 是统一守卫，迟到帧不得再改运行态。
 * 3. **只有明确的凭据 / 协议拒绝才停手**，其余按退避重连（见 `reconnect.ts`）。
 */
import { hostname, platform } from "node:os";

import {
  type ControlFrame,
  DATA_FRAME_KINDS,
  DEVICE_AUTH_HEADER,
  decodeControlFrame,
  decodeDataFrame,
  PROTOCOL_VERSION,
} from "@ucode/hub-protocol";
import { type RawData, WebSocket } from "ws";

import { HUB_HANDSHAKE_TIMEOUT_MS } from "../../constants/hub";
import { logger } from "../../platform/logger";
import { serviceVersion } from "../../platform/version";
import { HUB_CLIENT_ERROR_CODES, HubClientError, hubRequestTunnelTicket } from "./client";
import { getHubConfig, type HubConfig, subscribeHubConfig } from "./config";
import { reconnectDelayMs, resolveEndpoint } from "./endpoint";
import { resolveLocalTarget } from "./local-target";
import { describeReject, isPermanentReject } from "./reconnect";
import { setHubRuntimeState } from "./runtime";
import {
  classifyInbound,
  createSession,
  type InboundAction,
  isLive,
  sendControl,
  type TunnelSession,
  type TunnelStreamHandle,
} from "./session";
import { openStream } from "./streams";
import { toSocketBytes } from "./ws-forward";

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

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 升级被拒的状态码里哪些意味着「凭据不再有效」——重连没意义 */
const isCredentialStatus = (status: number): boolean => status === 401 || status === 403;

/** 数据链上的动作：与请求体同序，必须排在同一条链里 */
const isDataChannel = (action: InboundAction): boolean =>
  action.kind === "request" || action.kind === "requestEnd";

export const createHubTunnel = (): HubTunnel => {
  let started = false;
  let halted = false;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;
  /** 正在换票 / 建连的那一步：换票是异步的，没有它会与退避重连并发建出两条隧道 */
  let connecting: Promise<void> | null = null;
  let session: TunnelSession | null = null;
  let unsubscribeConfig: (() => void) | null = null;

  const clearHandshakeTimer = (target: TunnelSession): void => {
    if (target.handshakeTimer) {
      clearTimeout(target.handshakeTimer);
      target.handshakeTimer = null;
    }
  };

  const scheduleReconnect = (): void => {
    if (!started || reconnectTimer) return;
    if (halted) {
      setHubRuntimeState({ phase: "halted" });
      return;
    }
    const delay = reconnectDelayMs(attempt);
    attempt += 1;
    setHubRuntimeState({ phase: "reconnecting", reconnectAttempt: attempt });
    logger.debug({ delayMs: delay, attempt }, "中继隧道将按退避重连");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
    reconnectTimer.unref();
  };

  /**
   * 连接收尾：取消在飞转发、清计时器、更新运行态，并按 `reconnect` 决定要不要重连。
   * 主动换代（配置变更 / stop）传 false——下一步由调用方决定，别让重连再插一脚。
   */
  const settleSession = (
    target: TunnelSession,
    reason: string,
    opts: { reconnect: boolean; failure?: string | null },
  ): void => {
    if (target.settled) return;
    target.settled = true;
    clearHandshakeTimer(target);
    for (const handle of target.streams.values()) handle.abort(reason);
    target.streams.clear();

    // 已被取代的连接只做本地清理：它是孤儿，改写运行态或再排一次重连都会污染真实连接
    if (session !== target) {
      logger.debug({ endpoint: target.endpoint, reason }, "已被取代的中继连接收尾");
      return;
    }
    session = null;

    const failure = opts.failure === undefined ? target.lastFailure : opts.failure;
    // 主动换代传 failure=null：那不是故障，界面上保留上一次确实的原因
    if (target.phase === "ready")
      logger.info({ endpoint: target.endpoint, reason }, "中继隧道已下线");
    else logger.debug({ endpoint: target.endpoint, reason }, "中继隧道在握手完成前断开");

    setHubRuntimeState({
      phase: opts.reconnect ? (halted ? "halted" : "reconnecting") : "idle",
      ...(failure ? { lastError: failure } : {}),
      reconnectAttempt: attempt,
    });
    if (opts.reconnect) scheduleReconnect();
  };

  /** 断开当前连接但不改「已启动」状态；不等关闭帧——中继见断开即注销这条隧道 */
  const dropCurrent = (reason: string): void => {
    const target = session;
    if (!target) return;
    settleSession(target, reason, { reconnect: false, failure: null });
    target.socket.terminate();
  };

  const settleWelcome = (target: TunnelSession, deviceId: string): void => {
    if (!isLive(target, session) || target.phase === "ready") return;
    target.phase = "ready";
    // 握手完成才认为这条隧道可用：此刻取一次本机转发目标，随会话持有
    target.local = resolveLocalTarget();
    clearHandshakeTimer(target);
    attempt = 0;
    setHubRuntimeState({
      phase: "ready",
      connectedAt: new Date().toISOString(),
      lastError: null,
      reconnectAttempt: 0,
    });
    logger.info({ endpoint: target.endpoint, deviceId }, "中继隧道已上线");
  };

  const settleReject = (target: TunnelSession, code: string, message: string): void => {
    if (!isLive(target, session)) return;
    halted = isPermanentReject(code);
    const reason = describeReject(code, message);
    target.lastFailure = reason;
    logger.warn({ endpoint: target.endpoint, code, halted }, "中继拒绝隧道握手");
    // 断开本身由 close 事件收敛；这里只把 halted 记下，重连决策在 scheduleReconnect
    target.socket.terminate();
  };

  const streamOf = (target: TunnelSession, id: number): TunnelStreamHandle | undefined =>
    target.streams.get(id);

  const dropStream = (target: TunnelSession, id: number): TunnelStreamHandle | undefined => {
    const handle = streamOf(target, id);
    target.streams.delete(id);
    return handle;
  };

  const handleAction = (target: TunnelSession, action: InboundAction): void => {
    if (!isLive(target, session)) return;

    switch (action.kind) {
      case "welcome":
        settleWelcome(target, action.deviceId);
        return;
      case "reject":
        settleReject(target, action.code, action.message);
        return;
      case "ping":
        sendControl(target, { t: "pong" });
        return;
      case "pong":
        return;
      case "request":
        openStream(target, action.frame, target.local);
        return;
      case "requestEnd":
        streamOf(target, action.id)?.endBody();
        return;
      case "close":
        dropStream(target, action.id)?.close?.(action.code, action.reason);
        return;
      case "abort":
        dropStream(target, action.id)?.abort(action.reason);
        return;
      case "ignore":
        logger.debug(
          { endpoint: target.endpoint, phase: target.phase },
          "隧道收到无关或无法解析的控制帧，已忽略",
        );
        return;
    }
  };

  /** 入站数据帧：请求体分块与文本块，直接交给对应流的句柄（背压随它返回的 promise 传回中继） */
  const handleDataFrame = (target: TunnelSession, bytes: Uint8Array): void | Promise<void> => {
    if (!isLive(target, session) || target.phase !== "ready") return;
    const frame = decodeDataFrame(bytes);
    if (!frame) {
      logger.debug({ endpoint: target.endpoint }, "隧道收到无法解析的数据帧");
      return;
    }
    const handle = streamOf(target, frame.streamId);
    if (!handle) {
      logger.debug({ streamId: frame.streamId }, "数据帧对应的流已收尾，已忽略");
      return;
    }
    // 只接受「请求体」方向的两类：响应方向的帧是本侧发的，收到即是协议错误
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
    // 上游读得慢时返回 promise：数据链会等它，等于把背压一路传回中继
    return handle.writeBody(frame.payload, frame.kind === DATA_FRAME_KINDS.requestText);
  };

  /** 控制帧与数据帧串行各自成链；同一链内的帧按到达顺序生效 */
  const enqueue = (
    target: TunnelSession,
    action: InboundAction,
    bytes: Uint8Array | null,
  ): void => {
    const run = (): void | Promise<void> =>
      bytes ? handleDataFrame(target, bytes) : handleAction(target, action);
    const chain = bytes || isDataChannel(action) ? "data" : "control";
    target[chain] = target[chain].then(run).catch((error) => {
      logger.warn(
        { endpoint: target.endpoint, error: reasonOf(error) },
        "隧道入站帧处理失败（连接保持，交由心跳判死）",
      );
    });
  };

  const onOpen = (target: TunnelSession): void => {
    target.handshakeTimer = setTimeout(() => {
      logger.warn({ endpoint: target.endpoint }, "中继隧道握手超时，断开重连");
      target.lastFailure ??= "与中继的握手超时";
      settleSession(target, "握手超时", { reconnect: true });
      target.socket.terminate();
    }, HUB_HANDSHAKE_TIMEOUT_MS);
    sendControl(target, {
      t: "hello",
      protocol: PROTOCOL_VERSION,
      clientVersion: serviceVersion,
      deviceName: hostname().slice(0, 100),
      platform: platform(),
    });
  };

  const onMessage = (target: TunnelSession, data: RawData, isBinary: boolean): void => {
    const bytes = toSocketBytes(data);
    if (isBinary) {
      enqueue(target, { kind: "ignore" }, bytes);
      return;
    }
    const frame: ControlFrame | null = decodeControlFrame(new TextDecoder().decode(bytes));
    enqueue(target, classifyInbound(frame, target.phase), null);
  };

  const onUnexpectedResponse = (target: TunnelSession, status: number): void => {
    if (!isLive(target, session)) return;
    // 升级被拒（设备令牌无效 / 已吊销）：中继不会建隧道，重连也没用，等用户重新登记
    halted = isCredentialStatus(status);
    target.lastFailure = `中继拒绝隧道握手（HTTP ${status}）`;
    logger.warn({ endpoint: target.endpoint, status, halted }, "中继拒绝了隧道握手");
    setHubRuntimeState({
      phase: halted ? "halted" : "reconnecting",
      lastError: target.lastFailure,
      reconnectAttempt: 0,
    });
    target.socket.terminate();
  };

  const attachHandlers = (target: TunnelSession): void => {
    const socket = target.socket;
    socket.on("open", () => onOpen(target));
    socket.on("message", (data, isBinary) => onMessage(target, data, isBinary));
    socket.on("unexpected-response", (_request, response) => {
      // 不消费这个响应的话 ws 会一直等它
      response.resume();
      onUnexpectedResponse(target, response.statusCode ?? 0);
    });
    socket.on("error", (error) => {
      // 第一个失败原因才算原因（后面跟着的 close 只是它带出来的结果）
      target.lastFailure ??= `连接出错：${reasonOf(error)}`;
      logger.debug(
        { endpoint: target.endpoint, error: reasonOf(error) },
        "中继隧道连接出错（交由 close 收尾）",
      );
    });
    socket.on("close", (code, reason) => {
      const detail = reason.length > 0 ? ` ${reason.toString()}` : "";
      target.lastFailure ??= `连接关闭（${code}${detail}）`;
      settleSession(target, `连接关闭（${code}${detail}）`, { reconnect: true });
    });
  };

  /**
   * 换票失败：凭据失效就停手，其余（连不上、被限流、响应认不出）按退避重试。
   * 与握手被拒的判据一致——能自愈的重试，需要人干预的停下来说清原因。
   */
  const settleTicketFailure = (error: unknown): void => {
    const failure = error instanceof HubClientError ? error : null;
    if (failure?.code === HUB_CLIENT_ERROR_CODES.unauthorized) {
      halted = true;
      logger.warn({ error: failure.message }, "换取隧道票据被拒，停止重连");
      setHubRuntimeState({
        phase: "halted",
        lastError: `中继不再认可本机设备：${failure.message}（请在设置页重新登录中继）`,
        reconnectAttempt: 0,
      });
      return;
    }
    const reason = failure ? failure.message : reasonOf(error);
    logger.warn({ error: reason, attempt }, "换取隧道票据失败，按退避重试");
    setHubRuntimeState({ lastError: `换取隧道票据失败：${reason}` });
    scheduleReconnect();
  };

  /**
   * 建连：先向控制面换一张短期票据，再用票据升级 WS。
   *
   * 设备令牌**不出现在隧道握手里**——签票时中继已经查过库（在册、未吊销），
   * 隧道这一层只验签，所以中继核心不认识设备表。
   */
  /**
   * 建连入口：同一时刻只允许一次「换票 + 建 WS」在飞。
   *
   * 守卫不能只看 `session`——换票是异步的，期间 `session` 还是 null，`restart()` 与刚到点的
   * 退避 timer 会各自通过检查，建出两条隧道（第二条覆盖 `session`，第一条变成孤儿）。
   */
  function connect(): void {
    if (!started || session || connecting) return;
    connecting = runConnect()
      .catch((error) => settleTicketFailure(error))
      .finally(() => {
        connecting = null;
      });
  }

  async function runConnect(): Promise<void> {
    if (!started || session) return;

    const config = getHubConfig();
    const resolved = resolveEndpoint(config);
    if (resolved.kind !== "ready") {
      // 未启用 / 缺配置：没有可连的东西，不是失败（`lastError` 只放「缺什么」）
      setHubRuntimeState({
        phase: "idle",
        connectedAt: null,
        lastError: resolved.kind === "unusable" ? resolved.reason : null,
        reconnectAttempt: 0,
      });
      return;
    }

    setHubRuntimeState({ phase: "connecting" });
    let ticket: string;
    try {
      ticket = await hubRequestTunnelTicket(config.url ?? "", resolved.deviceToken);
    } catch (error) {
      settleTicketFailure(error);
      return;
    }
    // 换票是异步的：期间可能已被 stop，或已有别的连接抢先建立
    if (!started || session) return;

    const socket = new WebSocket(resolved.endpoint, {
      headers: { [DEVICE_AUTH_HEADER]: `Bearer ${ticket}` },
    });
    const target = createSession({
      socket,
      endpoint: resolved.endpoint,
      deviceId: resolved.deviceId,
    });
    session = target;
    logger.debug({ endpoint: resolved.endpoint, deviceId: resolved.deviceId }, "正在连接中继隧道");
    attachHandlers(target);
  }

  /** 只有这几项要重连：只改了展示用的用户名时不该把隧道拆了 */
  const isTunnelConfigChanged = (next: HubConfig, previous: HubConfig): boolean =>
    next.enabled !== previous.enabled ||
    next.url !== previous.url ||
    next.deviceToken !== previous.deviceToken ||
    next.deviceId !== previous.deviceId;

  const restart = (): void => {
    if (!started) return;
    halted = false;
    attempt = 0;
    dropCurrent("按新配置重建隧道");
    void connect();
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      halted = false;
      attempt = 0;
      unsubscribeConfig = subscribeHubConfig((next, previous) => {
        if (isTunnelConfigChanged(next, previous)) restart();
      });
      void connect();
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
      setHubRuntimeState({ phase: "idle", connectedAt: null, reconnectAttempt: 0 });
    },
    restart,
    isRunning: () => session !== null,
  };
};
