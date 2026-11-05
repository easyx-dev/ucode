/**
 * 服务实例的身份：本进程自己是谁，以及「端口上的服务是不是注册文件描述的那个进程」。
 *
 * `instanceId` 写进服务注册文件、也在 `GET /api/v1/health` 上回报，`service restart` 据此确认要结束的
 * 进程仍是我们服务的一个实例，而不是「pid 已被系统复用给了无关进程」。
 * 放在 `platform` 是因为服务注册（落盘）、健康探针（回报）与 CLI（核对）都要读它，且不含业务语义。
 */
import { randomUUID } from "node:crypto";

export const instanceId = randomUUID();

/** `GET /api/v1/health` 的载荷：只取核对身份需要的两个字段，不同版本多出的字段一概忽略 */
type HealthProbe = { data?: { up?: unknown; instanceId?: unknown } };

/**
 * 探到的服务是不是注册文件描述的那个实例。
 *
 * 注册文件里没有 `instanceId`（升级前写的文件，或那时服务还没重启过）时只认「存活探针答了 `up`」：
 * 否则升完级第一次 `service restart` 必然跳过，只能手工结束旧进程。代价是那个窗口里对同机另一个
 * `APP_HOME` 的实例可能认错——「结束进程」不可逆，所以除此之外一律从严（宁可留一个旧实例让用户
 * 手工处理，也不误杀无关进程：陈旧 pid 在 Windows 上必然存在，那边 `SIGTERM` 不触发优雅退出）。
 */
export const matchesInstance = (expected: string | null, payload: unknown): boolean => {
  const data = (payload as HealthProbe | null)?.data;
  if (expected === null) return data?.up === true;
  return data?.instanceId === expected;
};
