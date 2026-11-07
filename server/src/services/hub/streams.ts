/**
 * 把中继开的一条流接到本机服务：普通 HTTP 走 `forward.ts`，升级流走 `ws-forward.ts`，
 * 两者的结果再编成协议帧回给中继。
 *
 * 并发上限只有中继侧一道（`MAX_CONCURRENT_STREAMS`）：本侧不再设第二道闸——两套口径会让「超限」
 * 在两端表现成不同的状态码（中继 429、本侧 error 帧 → 502）。
 */
import { type RequestFrame, TUNNEL_ERROR_CODES } from "@ucode/hub-protocol";

import { HUB_UPGRADE_REJECT_CLOSE_CODES } from "../../constants/hub";
import { logger } from "../../platform/logger";
import { forwardToLocal, type LocalTarget } from "./forward";
import { sendControl, sendResponseBody, type TunnelSession } from "./session";
import { forwardUpgradeToLocal, toSocketBytes } from "./ws-forward";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** 升级流：本机侧是一条 WebSocket，双向泵字节，关闭码原样带回 */
const openUpgradeStream = (
  session: TunnelSession,
  frame: RequestFrame,
  local: LocalTarget,
): void => {
  // 建连就失败（地址拼不出来、连接同步抛）时 onError 已经回过错误帧，
  // 这时不能把一个空壳句柄留在表里占着流号——它再也不会被收尾
  let failed = false;
  const handle = forwardUpgradeToLocal(
    { frame, target: local },
    {
      onUpgrade: () =>
        sendControl(session, { t: "response", id: frame.id, status: 101, headers: {} }),
      onData: (chunk, isText) => sendResponseBody(session, frame.id, chunk, isText),
      onClose: (code, reason) => {
        session.streams.delete(frame.id);
        sendControl(session, { t: "close", id: frame.id, code, reason });
      },
      onError: (failure) => {
        failed = true;
        session.streams.delete(frame.id);
        if (failure.code === TUNNEL_ERROR_CODES.aborted) return;
        // 本机用普通 HTTP 拒绝了升级：状态码映射成关闭码回给浏览器（终端的 4401/4404 靠它区分终态），
        // 否则浏览器只看到「连接异常」，会一直重连
        const rejected = failure.httpStatus
          ? HUB_UPGRADE_REJECT_CLOSE_CODES[failure.httpStatus]
          : undefined;
        if (rejected !== undefined) {
          sendControl(session, {
            t: "close",
            id: frame.id,
            code: rejected,
            reason: "upgrade_rejected",
          });
          return;
        }
        sendControl(session, {
          t: "error",
          id: frame.id,
          code: failure.code,
          message: failure.message,
        });
      },
    },
  );
  if (!failed) session.streams.set(frame.id, handle);
  logger.debug({ streamId: frame.id, path: frame.path }, "隧道升级流已转到本机 WebSocket");
};

/** 普通流：请求体边到边送、响应逐块回传 */
const openHttpStream = (session: TunnelSession, frame: RequestFrame, local: LocalTarget): void => {
  session.streams.set(
    frame.id,
    forwardToLocal(
      { frame, target: local },
      {
        onResponse: (status, headers) =>
          sendControl(session, { t: "response", id: frame.id, status, headers }),
        onData: (chunk) => sendResponseBody(session, frame.id, chunk),
        onEnd: () => {
          session.streams.delete(frame.id);
          sendControl(session, { t: "responseEnd", id: frame.id });
        },
        onError: (failure) => {
          session.streams.delete(frame.id);
          // 公网侧断开时中继早已把这条流移出登记表，回错误帧只会被丢弃
          if (failure.code === TUNNEL_ERROR_CODES.aborted) return;
          sendControl(session, {
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

/** 开一条流：流号重复、读不到本机目标都在这里就地回错误帧 */
export const openStream = (
  session: TunnelSession,
  frame: RequestFrame,
  local: LocalTarget | null,
): void => {
  if (session.streams.has(frame.id)) {
    logger.debug({ streamId: frame.id }, "流号重复，忽略该请求");
    return;
  }
  if (!local) {
    sendControl(session, {
      t: "error",
      id: frame.id,
      code: TUNNEL_ERROR_CODES.localUnavailable,
      message: "读不到本机服务地址或凭证",
    });
    return;
  }

  try {
    if (frame.upgrade) openUpgradeStream(session, frame, local);
    else openHttpStream(session, frame, local);
  } catch (error) {
    session.streams.delete(frame.id);
    sendControl(session, {
      t: "error",
      id: frame.id,
      code: TUNNEL_ERROR_CODES.invalidRequest,
      message: `转发到本机服务失败：${reasonOf(error)}`,
    });
  }
};
