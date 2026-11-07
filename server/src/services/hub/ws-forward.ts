/**
 * 隧道的升级流 → 本机 WebSocket。
 *
 * 双向：浏览器侧的消息（请求体帧）写进本机 socket，本机 socket 的消息按响应体帧回传；
 * WebSocket 关闭码原样带回——终端的「进程结束 / 终端已不存在 / 凭证失效」全靠它区分。
 *
 * 本机连接建好之前到达的上行字节先排队（`MAX_UPGRADE_BUFFER_BYTES` 封顶）：握手往返期间用户敲的键
 * 不能丢，但也不能无限攒。socket 由调用方注入，这样这条泵的逻辑可以脱网单测。
 */
import {
  type HeaderMap,
  MAX_UPGRADE_BUFFER_BYTES,
  type RequestFrame,
  TUNNEL_ERROR_CODES,
} from "@ucode/hub-protocol";
import { type RawData, WebSocket } from "ws";

import type { LocalForwardFailure, LocalTarget } from "./forward";
import { buildHandshakeHeaders } from "./header-policy";
import { resolveUpgradeUrl } from "./local-target";

/** 本机连接：只声明用到的几件事，测试注入假的实现 */
export type UpgradeSocketLike = {
  onOpen(listener: () => void): void;
  /** `isText` 为真表示本机发的是 WebSocket 文本帧 */
  onMessage(listener: (chunk: Uint8Array, isText: boolean) => void): void;
  onClose(listener: (code: number, reason: string) => void): void;
  onError(listener: (error: Error) => void): void;
  /** 本机以普通 HTTP 响应拒绝了升级（没有 101） */
  onUnexpectedResponse(listener: (status: number) => void): void;
  /** 传 string 发文本帧、传字节发二进制帧 */
  send(chunk: string | Uint8Array): void;
  close(code: number, reason?: string): void;
  terminate(): void;
  /** 下游来不及发时停读本机（背压），`resume` 继续 */
  pause(): void;
  resume(): void;
};

export type UpgradeForwardHandle = {
  /** 浏览器侧上行（隧道请求体帧）：本机连接未就绪时排队；`text` 表示按文本帧发出 */
  writeBody(chunk: Uint8Array, text?: boolean): void;
  /** 升级流没有「请求体发完」的边界，调用无副作用 */
  endBody(): void;
  /** hub 侧关闭了这条流：把关闭码转给本机 socket，且不再回 `close` 帧 */
  close(code: number, reason?: string): void;
  /** 连接收尾：直接断开，不留半条流 */
  abort(reason?: string): void;
};

export type UpgradeForwardHandlers = {
  /** 本机 101 到达：可以开始双向 */
  onUpgrade(): void;
  /** 本机下行；`isText` 为真表示文本帧，回传时要保住这个类型。返回 promise 表示下游要背压 */
  onData(chunk: Uint8Array, isText: boolean): void | Promise<void>;
  /** 本机 socket 关闭：带归一后的关闭码 */
  onClose(code: number, reason: string): void;
  /** 建连失败或中途出错：调用方据此回 `error` 帧 */
  onError(failure: LocalForwardFailure): void;
};

/** `ws` 的入站数据统一成 `Uint8Array` 视图（Buffer / ArrayBuffer / Buffer[] 三种形态），不复制字节 */
export const toSocketBytes = (data: RawData): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

/**
 * 能出现在关闭帧里的码：1000、1001–1013（1004/1005/1006 是保留或本地状态）、3000–4999。
 * 其余（如 1006 表示「连接异常断开」、1015 表示 TLS 失败）一律换成 1011 再发，否则对端会判协议错误。
 */
const isSendableCloseCode = (code: number): boolean =>
  code === 1000 ||
  (code >= 1001 && code <= 1013 && code !== 1004 && code !== 1005 && code !== 1006) ||
  (code >= 3000 && code <= 4999);

const FALLBACK_CLOSE_CODE = 1011;

export const toSendableCloseCode = (code: number): number =>
  isSendableCloseCode(code) ? code : FALLBACK_CLOSE_CODE;

/**
 * 关闭帧载荷里留给原因的上限（字节）：RFC 6455 的控制帧载荷是 125 字节，扣掉 2 字节状态码。
 * 协议 schema 允许 200 **字符**，超了这个字节数 `ws` 会直接抛 `RangeError`（那会让本机 socket 关不掉）。
 */
const CLOSE_REASON_MAX_BYTES = 123;

/** 按 UTF-8 字节截断关闭原因：按字符截才不会把一个多字节字符切坏 */
export const truncateCloseReason = (reason: string | undefined): string | undefined => {
  if (!reason || Buffer.byteLength(reason) <= CLOSE_REASON_MAX_BYTES) return reason;
  let kept = "";
  let bytes = 0;
  for (const char of reason) {
    const size = Buffer.byteLength(char);
    if (bytes + size > CLOSE_REASON_MAX_BYTES) break;
    kept += char;
    bytes += size;
  }
  return kept;
};

/**
 * 由本机客户端自己决定、不能从帧里带进来的头见 `header-policy.ts`：
 * `sec-websocket-*` 由 `ws` 自己生成，`host` 与凭证由本侧重算。
 */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 默认连接：`ws` 客户端可以直接带自定义头（浏览器环境不行，这里是 Node） */
const connectWebSocket = (url: string, headers: HeaderMap): UpgradeSocketLike => {
  const socket = new WebSocket(url, { headers });
  return {
    onOpen: (listener) => socket.on("open", listener),
    onMessage: (listener) =>
      socket.on("message", (data, isBinary) =>
        listener(
          isBinary ? toSocketBytes(data) : new TextEncoder().encode(String(data)),
          !isBinary,
        ),
      ),
    onClose: (listener) => socket.on("close", (code, reason) => listener(code, reason.toString())),
    onError: (listener) => socket.on("error", listener),
    onUnexpectedResponse: (listener) =>
      socket.on("unexpected-response", (_request, response) => {
        const status = response.statusCode ?? 0;
        // 不消费这个响应的话 ws 会一直等它：销毁后收敛到「升级被拒」这一条路径
        response.destroy();
        listener(status);
      }),
    send: (chunk) => socket.send(chunk),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    pause: () => socket.pause(),
    resume: () => socket.resume(),
  };
};

const INERT_HANDLE: UpgradeForwardHandle = {
  writeBody: () => undefined,
  endBody: () => undefined,
  close: () => undefined,
  abort: () => undefined,
};

export const forwardUpgradeToLocal = (
  input: { frame: RequestFrame; target: LocalTarget },
  handlers: UpgradeForwardHandlers,
  connect: (url: string, headers: HeaderMap) => UpgradeSocketLike = connectWebSocket,
): UpgradeForwardHandle => {
  const { frame, target } = input;
  /** 本机连接就绪前排队的上行块（带文本标记） */
  let pending: { chunk: Uint8Array; text: boolean }[] = [];
  let pendingBytes = 0;
  let opened = false;
  /** 收尾只做一次：主动关闭与对端关闭都可能先到 */
  let finished = false;

  const clearPending = (): void => {
    pending = [];
    pendingBytes = 0;
  };

  const settle = (code: number, reason: string): void => {
    if (finished) return;
    finished = true;
    clearPending();
    handlers.onClose(code, reason);
  };

  const fail = (failure: LocalForwardFailure): void => {
    if (finished) return;
    finished = true;
    clearPending();
    handlers.onError(failure);
  };

  const url = resolveUpgradeUrl(target, frame.path);
  if (!url) {
    fail({
      code: TUNNEL_ERROR_CODES.invalidRequest,
      message: `隧道升级请求的路径非法：${frame.path}`,
    });
    return INERT_HANDLE;
  }

  let socket: UpgradeSocketLike;
  try {
    socket = connect(url, buildHandshakeHeaders(frame.headers, target.serviceToken));
  } catch (error) {
    fail({
      code: TUNNEL_ERROR_CODES.localUnreachable,
      message: `连不上本机服务：${reasonOf(error)}`,
    });
    return INERT_HANDLE;
  }

  socket.onOpen(() => {
    if (finished) return;
    opened = true;
    handlers.onUpgrade();
    const queued = pending;
    clearPending();
    for (const item of queued)
      socket.send(item.text ? new TextDecoder().decode(item.chunk) : item.chunk);
  });
  socket.onMessage((chunk, isText) => {
    if (finished) return;
    const sending = handlers.onData(chunk, isText);
    if (!sending) return;
    // 下游（隧道那一跳）发不动了就停读本机：终端一次大输出不往 ws 的发送队列里堆
    socket.pause();
    void sending.then(
      () => {
        if (!finished) socket.resume();
      },
      (error) =>
        fail({
          code: TUNNEL_ERROR_CODES.localFailed,
          message: `回传本机 WebSocket 数据失败：${reasonOf(error)}`,
        }),
    );
  });
  socket.onClose((code, reason) => settle(toSendableCloseCode(code), reason));
  socket.onError((error) =>
    fail({
      code: TUNNEL_ERROR_CODES.localFailed,
      message: `本机 WebSocket 出错：${reasonOf(error)}`,
    }),
  );
  socket.onUnexpectedResponse((status) =>
    fail({
      code: TUNNEL_ERROR_CODES.localRejected,
      message: `本机拒绝了 WebSocket 升级：HTTP ${status}`,
      httpStatus: status,
    }),
  );

  return {
    writeBody(chunk, text) {
      if (finished) return;
      // 终端的上行约定是文本帧：浏览器发的是文本帧时，本机也必须收到文本帧
      const payload = text ? new TextDecoder().decode(chunk) : chunk;
      if (opened) {
        socket.send(payload);
        return;
      }
      if (pendingBytes + chunk.byteLength > MAX_UPGRADE_BUFFER_BYTES) {
        // 本机连不上而浏览器一直发：断开而不是把上行攒进内存
        socket.terminate();
        fail({
          code: TUNNEL_ERROR_CODES.localFailed,
          message: "本机 WebSocket 建连前上行数据超过缓冲上限",
        });
        return;
      }
      pending.push({ chunk, text: text === true });
      pendingBytes += chunk.byteLength;
    },
    endBody: () => undefined,
    close(code, reason) {
      if (finished) return;
      finished = true;
      clearPending();
      socket.close(toSendableCloseCode(code), truncateCloseReason(reason));
    },
    abort() {
      if (finished) return;
      finished = true;
      clearPending();
      socket.terminate();
    },
  };
};
