/**
 * 服务凭证的读取与比较：`serviceToken`（本机原生客户端）与 `password`（登录）。
 *
 * 二者都等价于 owner 级凭证，明文存在 `service.json`（0600）；比较一律常量时间，
 * 避免从耗时推断前缀。改密码时由本对象统一落盘，确保中间件与路由看到同一份。
 */
import { timingSafeEqual } from "node:crypto";

import { type ServiceRegistration, writeServiceRegistration } from "../service-file";

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // 长度不同直接判否：长度本身不是敏感信息，却能让 timingSafeEqual 直接抛错
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export class CredentialStore {
  constructor(
    private registration: ServiceRegistration,
    private readonly path: string,
  ) {}

  verifyToken(candidate: string): boolean {
    return safeEqual(candidate, this.registration.serviceToken);
  }

  verifyPassword(candidate: string): boolean {
    return safeEqual(candidate, this.registration.password);
  }

  /**
   * 改密码并落盘；撤销全部会话由调用方负责（见 routes/auth/password）。
   * 必须原地更新：注册对象与 `services.auth.registration` 是同一份，
   * `/service/host` 会整体落盘它——换成新对象会让那次写入把旧密码带回来。
   */
  setPassword(next: string): void {
    this.registration.password = next;
    writeServiceRegistration(this.path, this.registration);
  }
}
