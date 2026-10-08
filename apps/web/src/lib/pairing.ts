/**
 * 配对链接落地：把地址栏上的 `?connect=<code>` 换成会话 token。
 *
 * 码是一次性的，而 React 严格模式下首屏 effect 会跑两遍——用模块级 promise 兜住，同一页面
 * 生命周期内只兑换一次；网络类失败不算终态，会清掉缓存让重试能再兑一次。
 */
import { asApiError, type Client } from "@ucode/sdk";

const CONNECT_KEY = "connect";

export type RedeemResult =
  /** 没有待兑换的码，或已经兑换成功 */
  | { status: "done" }
  /** 码确定不可用（无效 / 过期 / 已用过）：带原因去登录页 */
  | { status: "invalid"; errorCode: string }
  /** 网络不通 / 超时：码仍留在地址栏，由调用方走重试 */
  | { status: "retry"; errorCode: string };

/** 兑换成功（或码已作废）后把码从地址栏抹掉，别让它留在历史里 */
const dropConnectCode = (url: URL): void => {
  url.searchParams.delete(CONNECT_KEY);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

const redeem = async (client: Client): Promise<RedeemResult> => {
  const url = new URL(window.location.href);
  const code = url.searchParams.get(CONNECT_KEY);
  if (!code) return { status: "done" };

  try {
    await client.apis.auth.redeemPairing(code);
  } catch (error) {
    const failure = asApiError(error);
    // 400 才是「码作废」；网络 / 超时不丢码，刷新或重试都还能再兑
    if (failure.httpStatus !== 400) return { status: "retry", errorCode: failure.code };
    dropConnectCode(url);
    return { status: "invalid", errorCode: failure.code };
  }
  dropConnectCode(url);
  return { status: "done" };
};

let pending: Promise<RedeemResult> | null = null;

export const redeemConnectCode = (client: Client): Promise<RedeemResult> => {
  pending ??= redeem(client).then((result) => {
    if (result.status === "retry") pending = null;
    return result;
  });
  return pending;
};
