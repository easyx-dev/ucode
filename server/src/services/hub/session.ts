/**
 * 一条隧道会话的帧 I/O 与流表：把 WebSocket 与协议帧之间的往返收成几个动作，
 * 不决定「连不连」「重不重连」（那些在 `tunnel.ts` 与 `reconnect.ts`）。
 *
 * **两条入站链**：控制帧（`ping` / `pong` / `welcome` / `reject` / `close` / `abort`）走 `control`，
 * 数据帧与 `request` / `requestEnd` 走 `data`。分开是正确性要求——数据链会挂在本机上游的 drain 上
 * （一个大上传就能吊住几十秒），控制帧若排在它后面，中继的 `abort` 会迟到、`pong` 会迟到到被判死，
 * 单条流的背压就被放大成整条隧道断连。
 */
import {
  type ControlFrame,
  chunkPayload,
  DATA_FRAME_KINDS,
  encodeControlFrame,
  encodeDataFrame,
} from "@ucode/hub-protocol";
import type { WebSocket } from "ws";

import type { LocalTarget } from "./local-target";

/** 握手阶段：首帧 `hello` 之前不进流表；`ready` 才是中继认为可用的那条隧道 */
export type TunnelPhase = "handshake" | "ready";

/** 在飞流的两类收尾：普通请求有「请求体发完」，升级流有「关闭码」 */
export type TunnelStreamHandle = {
  /** `text` 表示这一块是 WebSocket 文本帧的内容（普通 HTTP 流转发时一定缺省） */
  writeBody(chunk: Uint8Array, text?: boolean): void | Promise<void>;
  endBody(): void;
  abort(reason?: string): void;
  close?(code: number, reason?: string): void;
};

export type TunnelSession = {
  socket: WebSocket;
  /** 隧道端点，日志里要能看出连的是哪台中继 */
  endpoint: string;
  /** 配置里的设备 id（welcome 帧给的更权威，仅用于日志） */
  deviceId: string | null;
  phase: TunnelPhase;
  handshakeTimer: NodeJS.Timeout | null;
  /** 在飞的转发：`abort` 帧与连接收尾按流号取消上游 */
  streams: Map<number, TunnelStreamHandle>;
  /** 收尾只做一次：close 事件与主动断开都会走到收尾 */
  settled: boolean;
  /**
   * 本机转发目标：握手完成时解析一次，随会话持有。
   * 每个流读一次注册文件等于每个请求一次同步盘 IO，而它只在服务重启（新 serviceToken）后才变。
   */
  local: LocalTarget | null;
  /** 本次会话为什么没连上 / 为什么断：写进运行态的 `lastError`，供界面直接显示 */
  lastFailure: string | null;
  /** 控制帧链 */
  control: Promise<void>;
  /** 数据帧链（与请求体同序） */
  data: Promise<void>;
};

export type InboundAction =
  | { kind: "welcome"; deviceId: string }
  | { kind: "reject"; code: string; message: string }
  | { kind: "ping" }
  | { kind: "pong" }
  | { kind: "request"; frame: Extract<ControlFrame, { t: "request" }> }
  | { kind: "requestEnd"; id: number }
  | { kind: "close"; id: number; code: number; reason?: string }
  | { kind: "abort"; id: number; reason: string }
  | { kind: "ignore" };

const IGNORE: InboundAction = { kind: "ignore" };

/**
 * 入站控制帧的归类：返回判别联合，调用方按 `kind` 直接分支，不必再对帧做二次收窄。
 *
 * 握手完成前只认 `welcome` / `reject`：此时中继还没把这条隧道登记为可用，请求帧与数据帧无处可去；
 * 上线后握手三件套再来一遍没有意义，`response` / `responseEnd` / `error` 只应由本侧发出，一并忽略。
 */
export const classifyInbound = (frame: ControlFrame | null, phase: TunnelPhase): InboundAction => {
  if (!frame) return IGNORE;

  if (phase === "handshake") {
    if (frame.t === "welcome") return { kind: "welcome", deviceId: frame.deviceId };
    if (frame.t === "reject") return { kind: "reject", code: frame.code, message: frame.message };
    return IGNORE;
  }

  switch (frame.t) {
    case "ping":
      return { kind: "ping" };
    case "pong":
      return { kind: "pong" };
    case "request":
      return { kind: "request", frame };
    case "requestEnd":
      return { kind: "requestEnd", id: frame.id };
    case "close":
      return { kind: "close", id: frame.id, code: frame.code, reason: frame.reason };
    case "abort":
      return { kind: "abort", id: frame.id, reason: frame.reason ?? "公网侧已断开" };
    default:
      return IGNORE;
  }
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createSession = (opts: {
  socket: WebSocket;
  endpoint: string;
  deviceId: string | null;
}): TunnelSession => ({
  socket: opts.socket,
  endpoint: opts.endpoint,
  deviceId: opts.deviceId,
  phase: "handshake",
  handshakeTimer: null,
  streams: new Map(),
  settled: false,
  local: null,
  lastFailure: null,
  control: Promise.resolve(),
  data: Promise.resolve(),
});

/**
 * 会话是否仍然有效：收尾过的、被新连接取代的会话收到迟到帧必须当场丢掉。
 *
 * 少了这道判定，握手超时后被 `terminate` 的连接上迟到的 `welcome` 会把运行态翻回「已连接」，
 * 而随后真正的 `close` 已因 `settled` 不再生效——界面会一直停在假在线。
 */
export const isLive = (session: TunnelSession, current: TunnelSession | null): boolean =>
  !session.settled && session === current;

/** 控制帧直发；连接已断时发送会抛，但那不该冒泡到转发回调里 */
export const sendControl = (session: TunnelSession, frame: ControlFrame): void => {
  try {
    session.socket.send(encodeControlFrame(frame));
  } catch (error) {
    // 发送失败只说明连接已经没了，收尾由 close 事件负责
    session.lastFailure ??= `控制帧发送失败：${reasonOf(error)}`;
  }
};

/** 送一帧已编码的字节；返回的 promise 在真正写出去后 resolve，转发侧据此背压 */
const writeBytes = (session: TunnelSession, bytes: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    session.socket.send(bytes, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

/**
 * 响应体逐块发出：一块可能超过单帧上限（本地大响应），按协议的切块口径拆开后顺序发。
 * `text` 表示这是 WebSocket 文本帧的内容，回传时要保住这个类型（终端下行靠它）。
 */
export const sendResponseBody = async (
  session: TunnelSession,
  streamId: number,
  chunk: Uint8Array,
  text = false,
): Promise<void> => {
  const kind = text ? DATA_FRAME_KINDS.responseText : DATA_FRAME_KINDS.responseBody;
  for (const part of chunkPayload(chunk)) {
    await writeBytes(session, encodeDataFrame({ kind, streamId, payload: part }));
  }
};
