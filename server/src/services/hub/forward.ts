/**
 * 隧道请求 → 本机服务：把中继回灌的请求转发给 `http://<loopback>:<port>`。
 *
 * 逐块流转发是这里的关键约束：请求体按隧道数据帧边到边写、响应体按 `http` 的 data 事件边到边交回调用方
 * （`onData` 返回 promise 时暂停上游读取），所以既不做整包缓冲，也不会把 SSE 攒成一坨后一次性发出。
 * 凭证补的是本机 `serviceToken`（中继不持有服务凭证），中继注入的来源头原样透传。
 *
 * 接口是回调式：调用方（隧道客户端）负责把回调里的内容编码成控制帧 / 数据帧。
 */
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";

import {
  type HeaderMap,
  type RequestFrame,
  TUNNEL_ERROR_CODES,
  type TunnelErrorCode,
} from "@ucode/hub-protocol";

import { logger } from "../../platform/logger";
import { buildDownstreamHeaders, buildUpstreamHeaders, toHeaderMap } from "./header-policy";
import { type LocalTarget, resolveLocalTarget, resolveUpstreamUrl } from "./local-target";

export type { LocalTarget };
export { resolveLocalTarget };

/** 该流转发出错：`code` 取自协议词表，随 `error` 帧回给中继 */
export type LocalForwardFailure = {
  code: TunnelErrorCode;
  /** 中文兜底文案，随 `error` 帧回给中继（进它的 debug 日志与 502 详情） */
  message: string;
  /** 本机以非 101 拒绝了 WebSocket 升级时的 HTTP 状态码（普通请求转发不会带） */
  httpStatus?: number;
};

export type LocalForwardHandlers = {
  /** 响应头到达：状态码与头由调用方原样回给中继 */
  onResponse(status: number, headers: HeaderMap): void;
  /** 响应体分块；返回 promise 表示下游要背压，转发会暂停上游读取 */
  onData(chunk: Uint8Array): void | Promise<void>;
  onEnd(): void;
  /** 该流转发出错：调用方据此回 `error` 帧 */
  onError(failure: LocalForwardFailure): void;
};

export type LocalForwardHandle = {
  /** 送一块请求体（隧道数据帧）；返回 promise 表示上游读得慢，等它 drain 再送下一块 */
  writeBody(chunk: Uint8Array): void | Promise<void>;
  /** 请求体送完 */
  endBody(): void;
  /** 公网侧断开或连接收尾：真正取消上游请求 */
  abort(reason?: string): void;
};

export type LocalForwardInput = {
  frame: RequestFrame;
  target: LocalTarget;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 已收尾的转发句柄：路径非法时交出它，后续调用都是空操作 */
const SETTLED_HANDLE: LocalForwardHandle = {
  writeBody: () => undefined,
  endBody: () => undefined,
  abort: () => undefined,
};

/** 一条在飞转发的收敛状态：响应与请求两侧共用，收尾只做一次 */
type ForwardState = {
  settled: boolean;
  /** 已开始的响应：上层取消时要把它一起销毁，否则连接会挂到上游超时 */
  upstream: IncomingMessage | null;
};

/** 响应体逐块回传；`onData` 返回 promise 时停读上游，等下游处理完再继续 */
const pumpResponseBody = (
  response: IncomingMessage,
  state: ForwardState,
  handlers: LocalForwardHandlers,
  fail: (failure: LocalForwardFailure) => void,
): void => {
  response.on("data", (chunk: Buffer) => {
    if (state.settled) return;
    const pending = handlers.onData(chunk);
    if (!pending) return;
    response.pause();
    void pending.then(
      () => {
        if (!state.settled) response.resume();
      },
      (error) =>
        fail({
          code: TUNNEL_ERROR_CODES.localFailed,
          message: `回传响应体失败：${reasonOf(error)}`,
        }),
    );
  });
};

/** 响应头到达后接管整条响应：先回状态码与头，再逐块泵响应体，末了按结束 / 中断分别收敛 */
const handleResponse = (
  frame: RequestFrame,
  state: ForwardState,
  handlers: LocalForwardHandlers,
  fail: (failure: LocalForwardFailure) => void,
) => {
  return (response: IncomingMessage): void => {
    state.upstream = response;
    logger.debug(
      { method: frame.method, path: frame.path, status: response.statusCode },
      "本机服务已回包",
    );
    handlers.onResponse(
      response.statusCode ?? 502,
      buildDownstreamHeaders(toHeaderMap(response.headers)),
    );

    pumpResponseBody(response, state, handlers, fail);

    response.on("end", () => {
      if (state.settled) return;
      state.settled = true;
      logger.debug({ method: frame.method, path: frame.path }, "本机服务响应已发完");
      handlers.onEnd();
    });

    // 上游没发完就断了（本机服务崩了、请求被销毁）：让公网侧看到中断，而不是静默的成功
    response.on("close", () => {
      if (!state.settled) {
        fail({ code: TUNNEL_ERROR_CODES.localFailed, message: "本机服务的响应中途中断" });
      }
    });

    response.on("error", (error) => {
      fail({
        code: TUNNEL_ERROR_CODES.localFailed,
        message: `读取响应失败：${reasonOf(error)}`,
      });
    });
  };
};

/** 请求体的一块：写不进去就等 drain（上游读得慢时把背压交回调用方） */
const writeChunk = (request: ClientRequest, chunk: Uint8Array): void | Promise<void> => {
  if (request.write(chunk)) return;
  return new Promise<void>((resolve) => {
    const done = (): void => {
      request.off("drain", done);
      request.off("close", done);
      resolve();
    };
    request.once("drain", done);
    request.once("close", done);
  });
};

/**
 * 转发一条隧道请求：立刻建上游请求（不等请求体），响应头一到就回调。
 * `frame.hasBody` 为 false 时立即结束请求体——中继只对带体的请求补 `requestEnd`。
 */
export const forwardToLocal = (
  input: LocalForwardInput,
  handlers: LocalForwardHandlers,
): LocalForwardHandle => {
  const { frame, target } = input;
  const url = resolveUpstreamUrl(target, frame.path);
  if (!url) {
    handlers.onError({
      code: TUNNEL_ERROR_CODES.invalidRequest,
      message: `隧道请求路径非法：${frame.path}`,
    });
    return SETTLED_HANDLE;
  }

  // 帧里的 method / 头名不是合法 HTTP token 时 `httpRequest` 会同步抛：
  // 在这里转成错误帧，别让异常冒到调用方（那边只会记日志，公网侧会一直等超时）
  let request: ClientRequest;
  try {
    request = httpRequest(url, {
      method: frame.method,
      headers: buildUpstreamHeaders(frame.headers, target.serviceToken),
    });
  } catch (error) {
    handlers.onError({
      code: TUNNEL_ERROR_CODES.invalidRequest,
      message: `隧道请求没法转成本机请求：${reasonOf(error)}`,
    });
    return SETTLED_HANDLE;
  }

  const state: ForwardState = { settled: false, upstream: null };
  const fail = (failure: LocalForwardFailure): void => {
    if (state.settled) return;
    state.settled = true;
    request.destroy();
    state.upstream?.destroy();
    const detail = { method: frame.method, path: frame.path, code: failure.code };
    if (failure.code === TUNNEL_ERROR_CODES.aborted) logger.debug(detail, "转发的请求已取消");
    else logger.warn({ ...detail, message: failure.message }, "转发到本机服务失败");
    handlers.onError(failure);
  };

  request.on("error", (error) => {
    fail({
      code: TUNNEL_ERROR_CODES.localUnreachable,
      message: `本机服务不可达：${reasonOf(error)}`,
    });
  });
  request.on("response", handleResponse(frame, state, handlers, fail));

  if (!frame.hasBody) request.end();

  return {
    writeBody: (chunk) => {
      if (state.settled || request.destroyed) return;
      return writeChunk(request, chunk);
    },
    endBody: () => {
      if (state.settled || request.destroyed) return;
      request.end();
    },
    abort: (reason) => {
      fail({ code: TUNNEL_ERROR_CODES.aborted, message: reason ?? "公网侧已断开" });
    },
  };
};
