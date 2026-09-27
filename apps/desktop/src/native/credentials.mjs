// 桌面壳的 OS 凭据存储（F-5.4）。
//
// 用 Electron 的 `safeStorage`（macOS 钥匙串 / Windows DPAPI / Linux libsecret）加密后落盘：
// 数据层里只出现**密文**，明文只在内存与钥匙串里。
//
// 两条硬约定：
// 1. **加密不可用就拒存**——宁可存不进去，也不把明文写到磁盘上（"等能用时再加密"从来不会发生）；
// 2. 明文只经 `get` 返回给调用方，日志与错误信息里绝不含它。
//
// 纯 JS（Electron 直载主进程，不经打包器），加密能力由外部注入 → 可脱离 Electron 单测。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const CREDENTIALS_VERSION = 1;

export class EncryptionUnavailableError extends Error {
  constructor() {
    super("当前系统的凭据加密不可用（safeStorage），拒绝以明文保存。");
    this.name = "EncryptionUnavailableError";
  }
}

export function credentialsFileFor(dataDir) {
  return `${dataDir}/credentials.json`;
}

export class CredentialStore {
  /**
   * @param {{ file: string, crypto: { isEncryptionAvailable(): boolean, encryptString(value: string): Buffer, decryptString(value: Buffer): string } }} options
   */
  constructor(options) {
    this.file = options.file;
    this.crypto = options.crypto;
    /** @type {Record<string, string>} 名称 → base64 密文 */
    this.items = {};
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8"));
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.items &&
        typeof parsed.items === "object"
      ) {
        this.items = { ...parsed.items };
      }
    } catch {
      this.items = {}; // 没有文件/格式不对：当作空存储
    }
    return this;
  }

  list() {
    return Object.keys(this.items).sort();
  }

  has(name) {
    return Object.hasOwn(this.items, name);
  }

  /** 存入（加密）。加密不可用直接抛错，不落明文。 */
  set(name, value) {
    if (!this.crypto.isEncryptionAvailable()) throw new EncryptionUnavailableError();
    if (typeof name !== "string" || name.trim() === "") throw new Error("凭据名不能为空。");
    if (typeof value !== "string" || value === "") throw new Error("凭据值不能为空。");
    const encrypted = this.crypto.encryptString(value);
    this.items[name] = Buffer.from(encrypted).toString("base64");
    this.#save();
  }

  /** 取出（解密）；没有或解不开返回 null（不抛，调用方按"没配"处理）。 */
  get(name) {
    const blob = this.items[name];
    if (blob === undefined) return null;
    try {
      return this.crypto.decryptString(Buffer.from(blob, "base64"));
    } catch {
      return null;
    }
  }

  delete(name) {
    if (!Object.hasOwn(this.items, name)) return false;
    delete this.items[name];
    this.#save();
    return true;
  }

  #save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    // 0600：即使同一台机器上的其他用户也读不到（虽然内容本身已是密文）。
    writeFileSync(
      this.file,
      JSON.stringify({ version: CREDENTIALS_VERSION, items: this.items }, null, 2),
      {
        mode: 0o600,
      },
    );
  }
}
