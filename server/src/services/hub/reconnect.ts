/**
 * 中继拒绝之后怎么处理：哪些拒绝值得再试、哪些只能等人干预。
 *
 * 这是从一次真实故障里定下的口径——「被拒即退出、不再重试」会把中继的一次滚动重启放大成
 * 设备永久离线（重试没有代价，不试才有）。所以只有**凭据失效**与**协议不兼容**才停手，
 * 其余（被新连接接管、中继暂时判定异常）照常退避重连。
 */
import { TUNNEL_ERROR_CODES } from "@ucode/hub-protocol";

/**
 * 该拒绝码是否意味着「重试无用」：
 * - `device_unauthorized`：设备令牌无效或已吊销，重连只会被同样拒绝；
 * - `protocol_mismatch`：两端协议版本不兼容，要等任一端升级。
 *
 * `device_taken_over`（同一设备的新连接接管了旧的）**不在其中**：新的那条可能马上断开，
 * 本侧应当重新抢回来。
 */
export const isPermanentReject = (code: string): boolean =>
  code === TUNNEL_ERROR_CODES.deviceUnauthorized || code === TUNNEL_ERROR_CODES.protocolMismatch;

/** 拒绝的中文原因：直接显示在设置页，且要说清「下一步该做什么」 */
export const describeReject = (code: string, message: string): string => {
  if (code === TUNNEL_ERROR_CODES.protocolMismatch) {
    return `中继与客户端的隧道协议不兼容：${message}`;
  }
  if (code === TUNNEL_ERROR_CODES.deviceUnauthorized) {
    return `中继不再认可本机设备：${message}（请在设置页重新登录中继）`;
  }
  return `中继拒绝隧道握手：${message}`;
};
