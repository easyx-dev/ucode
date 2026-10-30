/**
 * 隧道请求 → 本机服务：把中继回灌的请求转发给 `http://<loopback>:<port>`。
 *
 * 逐块流转发是这里的关键约束：请求体按隧道数据帧边到边写、响应体按 `http` 的 data 事件边到边交回调用方
 * （`onData` 返回 promise 时暂停上游读取），所以既不做整包缓冲，也不会把 SSE 攒成一坨后一次性发出。
 * 凭证补的是本机 `serviceToken`（中继不持有服务凭证），中继注入的来源头原样透传。
 *
 * 接口是回调式：调用方（隧道客户端）负责把回调里的内容编码成控制帧 / 数据帧。
 */
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";

import type { RequestFrame } from "@ucode/hub-protocol";

import { env } from "../../env";
import { logger } from "../../platform/logger";
import { readServiceRegistration, toUrlHost } from "../../platform/service-registration";

export const HUB_FORWARD_ERROR_CODES = {
  /** 隧道给的路径不能拼成合法请求 */
  invalidRequest: "invalid_request",
  /** 读不到本机服务地址或凭证 */
  localUnavailable: "local_unavailable",
  /** 连不上本机服务 */
  localUnreachable: "local_unreachable",
  /** 本机服务在响应中途出错或中断 */
  localFailed: "local_failed",
  /** 公网侧已断开，上游请求随之取消 */
  aborted: "aborted",
  /** 本机以非 101 的 HTTP 响应拒绝了 WebSocket 升级（`httpStatus` 带状态码） */
  localRejected: "local_rejected",
} as const;

export type HubForwardErrorCode =
  (typeof HUB_FORWARD_ERROR_CODES)[keyof typeof HUB_FORWARD_ERROR_CODES];

export type LocalForwardFailure = {
  code: HubForwardErrorCode;
  /** 中文兜底文案，随 `error` 帧回给中继（进它的 debug 日志与 502 详情） */
  message: string;
  /** 本机以非 101 拒绝了 WebSocket 升级时的 HTTP 状态码（普通请求转发不会带） */
  httpStatus?: number;
};

/** 本机服务的转发目标：地址取注册文件（端口自选时只有它写着真实端口），凭证同源 */
export type LocalTarget = {
  /** 如 `http://127.0.0.1:19688`，无末尾斜杠 */
  origin: string;
  serviceToken: string;
};

export type LocalForwardHandlers = {
  /** 响应头到达：状态码与头由调用方原样回给中继 */
  onResponse(status: number, headers: Record<string, string>): void;
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

/**
 * 逐跳头（RFC 9110 §7.6.1）：只对单跳有意义，两个方向都不能透传。
 * 尤其 `transfer-encoding` —— 分块方式由每一跳自己决定（本侧重切了块，中继那一跳还会再切一次）。
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** 请求侧还要剥掉的：Host 由本侧决定，Content-Length 由重切块后的实际字节数决定，凭证由本侧补 */
const STRIPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  "host",
  "content-length",
  "authorization",
  "cookie",
]);

/**
 * 本机服务的转发目标；读不到注册文件时回落到 env 声明的监听形态。
 * 端口自选（`APP_PORT=0`）时真实端口只写在注册文件里，故以文件为准。
 */
export const resolveLocalTarget = (): LocalTarget | null => {
  const registration = readServiceRegistration(env.servicePath);
  const port = registration && registration.port > 0 ? registration.port : env.port;
  const serviceToken = registration?.serviceToken;
  if (!serviceToken || port <= 0) return null;
  return { origin: `http://${toUrlHost(registration?.host ?? env.host)}:${port}`, serviceToken };
};

/** 拼上游 URL：路径必须是绝对路径，`//host` 会被当成协议相对地址而换掉主机，一并拒掉 */
export const resolveUpstreamUrl = (target: LocalTarget, path: string): URL | null => {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  try {
    return new URL(`${target.origin}${path}`);
  } catch {
    return null;
  }
};

/**
 * 转发给本机服务的请求头：剥掉逐跳头与上面那几类，补上本机 `serviceToken`。
 * 来源头（`x-hub-*`）原样带过去——它是中继注入的事实，本侧不自己造（见 `constants/hub`）。
 */
export const buildUpstreamHeaders = (
  headers: Record<string, string>,
  serviceToken: string,
): Record<string, string> => {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    forwarded[name] = value;
  }
  forwarded.authorization = `Bearer ${serviceToken}`;
  return forwarded;
};

/** 回给中继的响应头：只剥逐跳头，`content-type` / `cache-control` / `content-length` 等原样带过去 */
export const buildDownstreamHeaders = (headers: Record<string, string>): Record<string, string> => {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    forwarded[name] = value;
  }
  return forwarded;
};

/** `http` 的响应头 → 隧道协议要的字符串映射：同名多值按 HTTP 规则逗号连接 */
export const toHeaderRecord = (headers: IncomingHttpHeaders): Record<string, string> => {
  const record: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    record[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return record;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 已收尾的转发句柄：路径非法时交出它，后续调用都是空操作 */
const SETTLED_HANDLE: LocalForwardHandle = {
  writeBody: () => undefined,
  endBody: () => undefined,
  abort: () => undefined,
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
      code: HUB_FORWARD_ERROR_CODES.invalidRequest,
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
      code: HUB_FORWARD_ERROR_CODES.invalidRequest,
      message: `隧道请求没法转成本机请求：${reasonOf(error)}`,
    });
    return SETTLED_HANDLE;
  }
  let settled = false;
  /** 已开始的响应：上层取消时要把它一起销毁，否则连接会挂到上游超时 */
  let upstream: IncomingMessage | null = null;

  const fail = (failure: LocalForwardFailure): void => {
    if (settled) return;
    settled = true;
    request.destroy();
    upstream?.destroy();
    const detail = { method: frame.method, path: frame.path, code: failure.code };
    if (failure.code === HUB_FORWARD_ERROR_CODES.aborted) logger.debug(detail, "转发的请求已取消");
    else logger.warn({ ...detail, message: failure.message }, "转发到本机服务失败");
    handlers.onError(failure);
  };

  request.on("error", (error) => {
    fail({
      code: HUB_FORWARD_ERROR_CODES.localUnreachable,
      message: `本机服务不可达：${reasonOf(error)}`,
    });
  });

  request.on("response", (response) => {
    upstream = response;
    logger.debug(
      { method: frame.method, path: frame.path, status: response.statusCode },
      "本机服务已回包",
    );
    handlers.onResponse(
      response.statusCode ?? 502,
      buildDownstreamHeaders(toHeaderRecord(response.headers)),
    );

    response.on("data", (chunk: Buffer) => {
      if (settled) return;
      const pending = handlers.onData(chunk);
      if (!pending) return;
      // 下游要背压：先停上游读，等它处理完再继续（事件流逐帧、大响应不整包进内存）
      response.pause();
      void pending.then(
        () => {
          if (!settled) response.resume();
        },
        (error) => {
          fail({
            code: HUB_FORWARD_ERROR_CODES.localFailed,
            message: `回传响应体失败：${reasonOf(error)}`,
          });
        },
      );
    });

    response.on("end", () => {
      if (settled) return;
      settled = true;
      logger.debug({ method: frame.method, path: frame.path }, "本机服务响应已发完");
      handlers.onEnd();
    });

    // 上游没发完就断了（本机服务崩了、请求被销毁）：让公网侧看到中断，而不是静默的成功
    response.on("close", () => {
      if (!settled) {
        fail({ code: HUB_FORWARD_ERROR_CODES.localFailed, message: "本机服务的响应中途中断" });
      }
    });

    response.on("error", (error) => {
      fail({
        code: HUB_FORWARD_ERROR_CODES.localFailed,
        message: `读取响应失败：${reasonOf(error)}`,
      });
    });
  });

  if (!frame.hasBody) request.end();

  return {
    writeBody: (chunk) => {
      if (settled || request.destroyed) return;
      if (request.write(chunk)) return;
      // 上游读得慢：把背压交回调用方（它串行处理入站帧，等 drain 再送下一块）
      return new Promise<void>((resolve) => {
        const done = (): void => {
          request.off("drain", done);
          request.off("close", done);
          resolve();
        };
        request.once("drain", done);
        request.once("close", done);
      });
    },
    endBody: () => {
      if (settled || request.destroyed) return;
      request.end();
    },
    abort: (reason) => {
      fail({ code: HUB_FORWARD_ERROR_CODES.aborted, message: reason ?? "公网侧已断开" });
    },
  };
};
