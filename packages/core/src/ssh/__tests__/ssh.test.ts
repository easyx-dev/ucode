import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addConnection,
  findConnection,
  listConnections,
  normalizeConnection,
  removeConnection,
  sshFileFor,
} from "../registry.ts";
import { remoteTarget, runRemote, type SshExec, shellQuote, sshArgv } from "../remote.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ssh-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("normalizeConnection", () => {
  it("规范化并去掉空字段", () => {
    const connection = normalizeConnection({
      name: " prod ",
      host: " example.com ",
      user: "",
      description: "",
    });
    expect(connection).toEqual({ name: "prod", host: "example.com" });
  });

  it("主机名/用户名里的 shell 元字符一律拒绝", () => {
    expect(() => normalizeConnection({ name: "a", host: "example.com; rm -rf /" })).toThrow();
    expect(() => normalizeConnection({ name: "a", host: "example.com", user: "u$er" })).toThrow();
    expect(() => normalizeConnection({ name: "bad name", host: "example.com" })).toThrow();
  });

  it("端口越界拒绝", () => {
    expect(() => normalizeConnection({ name: "a", host: "h", port: 0 })).toThrow();
    expect(() => normalizeConnection({ name: "a", host: "h", port: 70000 })).toThrow();
    expect(normalizeConnection({ name: "a", host: "h", port: 2222 }).port).toBe(2222);
  });
});

describe("addConnection", () => {
  it("增删查列，且同名覆盖", async () => {
    await addConnection(root, { name: "prod", host: "a.example.com" });
    await addConnection(root, { name: "dev", host: "b.example.com", user: "me" });
    await addConnection(root, { name: "prod", host: "c.example.com" }); // 同名覆盖

    const list = await listConnections(root);
    expect(list.map((connection) => connection.name)).toEqual(["dev", "prod"]);
    expect((await findConnection(root, "prod"))?.host).toBe("c.example.com");

    expect(await removeConnection(root, "dev")).toBe(true);
    expect(await removeConnection(root, "dev")).toBe(false);
    expect((await listConnections(root)).map((connection) => connection.name)).toEqual(["prod"]);
  });

  it("落盘的是连接定义，不含任何密钥字段", async () => {
    await addConnection(root, { name: "prod", host: "a.example.com", user: "deploy" });
    const raw = await readFile(sshFileFor(root), "utf8");
    expect(raw).toContain("a.example.com");
    for (const forbidden of ["password", "privateKey", "secret", "passphrase"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe("sshArgv", () => {
  it("批量模式 + 目标 + 命令原样作为最后一个参数", () => {
    const argv = sshArgv({ name: "p", host: "h.example.com", user: "me" }, "uname -a");
    expect(argv).toContain("BatchMode=yes");
    expect(argv).toContain("StrictHostKeyChecking=accept-new");
    expect(argv).toContain("me@h.example.com");
    expect(argv.at(-1)).toBe("uname -a");
  });

  it("端口与私钥按需带上；无 user 时目标只是主机", () => {
    const argv = sshArgv({ name: "p", host: "h", port: 2222, identityFile: "/k/id" }, "ls");
    expect(argv).toEqual(expect.arrayContaining(["-p", "2222", "-i", "/k/id"]));
    expect(remoteTarget({ name: "p", host: "h" })).toBe("h");
  });
});

describe("执行器（注入假 exec，不真连机器）", () => {
  describe("runRemote", () => {
    it("把 argv 交给 ssh 并原样带回结果", async () => {
      const calls: { file: string; args: string[] }[] = [];
      const exec: SshExec = async (file, args) => {
        calls.push({ file, args });
        return { stdout: "Linux\n", stderr: "", exitCode: 0 };
      };
      const result = await runRemote({ name: "p", host: "h", user: "me" }, "uname", { exec });
      expect(result).toEqual({ stdout: "Linux\n", stderr: "", exitCode: 0 });
      expect(calls[0]?.file).toBe("ssh");
      expect(calls[0]?.args.at(-1)).toBe("uname");
    });

    it("指定 cwd 时用引号包裹的 cd（远端 shell 解释）", async () => {
      let seen = "";
      const exec: SshExec = async (_file, args) => {
        seen = args.at(-1) ?? "";
        return { stdout: "", stderr: "", exitCode: 0 };
      };
      await runRemote({ name: "p", host: "h" }, "ls", { exec, cwd: "/srv/app" });
      expect(seen).toBe("cd -- '/srv/app' && ls");
    });
  });

  describe("shellQuote", () => {
    it("单引号路径按 POSIX 规则转义", () => {
      expect(shellQuote("/a'b")).toBe("'/a'\\''b'");
    });
  });
});
