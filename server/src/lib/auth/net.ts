/** 挑选一个可用于局域网访问的 IPv4 地址；没有时回退 127.0.0.1 */
import { networkInterfaces } from "node:os";

export const pickLanAddress = (): string => {
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "127.0.0.1";
};
