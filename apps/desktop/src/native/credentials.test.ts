import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialStore, credentialsFileFor, EncryptionUnavailableError } from "./credentials.mjs";

/**
 * 凭据存储的单测：加密能力注入一个"可逆但不等于明文"的假实现，
 * 因此不依赖 Electron，也能验证"落盘是密文"这条安全约定。
 */

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cred-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fakeCrypto = (available = true) => ({
  isEncryptionAvailable: () => available,
  // 假加密：可逆变换 + 前缀，确保密文里**不含明文原串**。
  encryptString: (value: string) =>
    Buffer.from(`enc:${value.split("").reverse().join("")}`, "utf8"),
  decryptString: (buffer: Buffer) => {
    const text = buffer.toString("utf8");
    if (!text.startsWith("enc:")) throw new Error("不是本实现加密的数据");
    return text.slice(4).split("").reverse().join("");
  },
});

describe("凭据存储", () => {
  it("加密后落盘：文件里不含明文，取回得到原文", () => {
    const store = new CredentialStore({ file: credentialsFileFor(root), crypto: fakeCrypto() });
    store.set("deepseek", "sk-super-secret");

    const raw = readFileSync(credentialsFileFor(root), "utf8");
    expect(raw).not.toContain("sk-super-secret");
    expect(store.get("deepseek")).toBe("sk-super-secret");
    expect(store.list()).toEqual(["deepseek"]);
  });

  it("重开进程后仍能取回（密文持久化）", () => {
    const file = credentialsFileFor(root);
    new CredentialStore({ file, crypto: fakeCrypto() }).set("openai", "sk-2");
    const reopened = new CredentialStore({ file, crypto: fakeCrypto() });
    expect(reopened.get("openai")).toBe("sk-2");
  });

  it("加密不可用时拒存（不落明文）", () => {
    const store = new CredentialStore({
      file: credentialsFileFor(root),
      crypto: fakeCrypto(false),
    });
    expect(() => store.set("x", "plain")).toThrow(EncryptionUnavailableError);
    expect(() => readFileSync(credentialsFileFor(root), "utf8")).toThrow(); // 文件根本没建
  });

  it("解不开的密文返回 null（不抛），删除返回是否真的删了", () => {
    const store = new CredentialStore({ file: credentialsFileFor(root), crypto: fakeCrypto() });
    store.set("a", "v");
    expect(store.delete("a")).toBe(true);
    expect(store.delete("a")).toBe(false);
    expect(store.get("a")).toBeNull();

    // 手写一个坏值：get 应该安静地返回 null
    writeFileSync(
      credentialsFileFor(root),
      JSON.stringify({ version: 1, items: { broken: Buffer.from("garbage").toString("base64") } }),
    );
    const reopened = new CredentialStore({ file: credentialsFileFor(root), crypto: fakeCrypto() });
    expect(reopened.get("broken")).toBeNull();
  });

  it("空名/空值被拒绝", () => {
    const store = new CredentialStore({ file: credentialsFileFor(root), crypto: fakeCrypto() });
    expect(() => store.set("", "v")).toThrow();
    expect(() => store.set("n", "")).toThrow();
  });
});
