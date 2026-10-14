/** services/plugins/sources：五种来源的拉取与暂存（出网与进程调用都注入假实现） */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { zipSync } from "fflate";
import { PLUGIN_BIN_DIRNAME, PLUGIN_MANIFEST_DIRNAME } from "../../../../constants/dirs";

import { SourceError, type SourceRunner, stagePluginSource } from "..";

const created: string[] = [];

const makeDir = (prefix = "plugin-source-"): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
};

/** 造一个最小插件包目录 */
const makePackage = (dir: string, name = "demo"): string => {
  mkdirSync(join(dir, PLUGIN_MANIFEST_DIRNAME), { recursive: true });
  writeFileSync(
    join(dir, PLUGIN_MANIFEST_DIRNAME, "plugin.json"),
    JSON.stringify({ name, version: "1.0.0" }),
    "utf8",
  );
  return dir;
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("stagePluginSource", () => {
  it("directory 来源直接引用，不复制，并给出目录内容哈希", async () => {
    const source = makePackage(makeDir());
    const staged = await stagePluginSource({
      source: { source: "directory", path: source },
      stagingRoot: makeDir(),
    });

    assert.equal(staged.path, realpathSync(source));
    assert.equal(staged.staged, false);
    assert.match(staged.integrity ?? "", /^[0-9a-f]{64}$/);
  });

  it("directory 来源目录不存在时直接失败", async () => {
    await assert.rejects(
      stagePluginSource({
        source: { source: "directory", path: join(makeDir(), "nope") },
        stagingRoot: makeDir(),
      }),
      (error: unknown) => error instanceof Error && /路径不存在/.test(error.message),
    );
  });

  it("url 来源解包 zip，并在一层子目录里找到插件根", async () => {
    const archive = zipSync({
      [`pkg/${PLUGIN_MANIFEST_DIRNAME}/plugin.json`]: new TextEncoder().encode(
        '{"name":"zip-demo"}',
      ),
      "pkg/skills/review/SKILL.md": new TextEncoder().encode("正文"),
    });
    const stagingRoot = makeDir();

    const staged = await stagePluginSource({
      source: { source: "url", url: "https://example.com/pkg.zip" },
      stagingRoot,
      fetch: async () => ({
        url: new URL("https://example.com/pkg.zip"),
        status: 200,
        body: archive,
        truncated: false,
        contentType: "application/zip",
        etag: null,
        lastModified: null,
      }),
    });

    assert.equal(staged.staged, true);
    assert.equal(existsSync(join(staged.path, PLUGIN_MANIFEST_DIRNAME, "plugin.json")), true);
    assert.equal(readFileSync(join(staged.path, "skills", "review", "SKILL.md"), "utf8"), "正文");
    assert.match(staged.integrity ?? "", /^[0-9a-f]{64}$/);
  });

  it("url 来源：zip 里的 bin/ 脚本补上了可执行位（zip 不携带 unix 权限位）", async () => {
    const archive = zipSync({
      [`pkg/${PLUGIN_MANIFEST_DIRNAME}/plugin.json`]: new TextEncoder().encode(
        '{"name":"zip-bin"}',
      ),
      [`pkg/${PLUGIN_BIN_DIRNAME}/run`]: new TextEncoder().encode("#!/bin/sh\necho hi\n"),
    });

    const staged = await stagePluginSource({
      source: { source: "url", url: "https://example.com/pkg.zip" },
      stagingRoot: makeDir(),
      fetch: async () => ({
        url: new URL("https://example.com/pkg.zip"),
        status: 200,
        body: archive,
        truncated: false,
        contentType: "application/zip",
        etag: null,
        lastModified: null,
      }),
    });

    const script = join(staged.path, PLUGIN_BIN_DIRNAME, "run");
    assert.equal(existsSync(script), true, "bin 目录随包一起解出来了");
    if (process.platform !== "win32") {
      assert.equal(statSync(script).mode & 0o111, 0o111, "bin 脚本应可执行");
    }
  });

  it("url 来源：非 2xx、截断、认不出格式都失败", async () => {
    const stagingRoot = makeDir();
    const base = {
      source: { source: "url" as const, url: "https://example.com/pkg.zip" },
      stagingRoot,
    };
    const respond = (over: Record<string, unknown>) => async () =>
      ({
        url: new URL("https://example.com/pkg.zip"),
        status: 200,
        body: new Uint8Array([0x50, 0x4b]),
        truncated: false,
        contentType: null,
        etag: null,
        lastModified: null,
        ...over,
      }) as never;

    await assert.rejects(
      stagePluginSource({ ...base, fetch: respond({ status: 404 }) }),
      (error: unknown) => error instanceof SourceError && /HTTP 404/.test(error.message),
    );
    await assert.rejects(
      stagePluginSource({ ...base, fetch: respond({ truncated: true }) }),
      (error: unknown) => error instanceof SourceError && /超过上限/.test(error.message),
    );
    await assert.rejects(
      stagePluginSource({
        ...base,
        source: { source: "url", url: "https://example.com/pkg.tar.zst" },
        fetch: respond({ body: new Uint8Array([1, 2, 3]) }),
      }),
      (error: unknown) => error instanceof SourceError && /不是 zip 也不是 tgz/.test(error.message),
    );
  });

  it("npm 来源走 npm install，然后在 node_modules 下取包目录", async () => {
    const stagingRoot = makeDir();
    const calls: string[][] = [];
    const run: SourceRunner = async (file, args) => {
      calls.push([file, ...args]);
      const prefix = args[args.indexOf("--prefix") + 1] ?? "";
      makePackage(join(prefix, "node_modules", "@scope", "demo-pkg"), "npm-demo");
      return { stdout: "" };
    };

    const staged = await stagePluginSource({
      source: { source: "npm", package: "@scope/demo-pkg@1.2.3" },
      stagingRoot,
      run,
    });

    assert.deepEqual(calls[0]?.slice(0, 3), ["npm", "install", "--prefix"]);
    assert.equal(staged.path.endsWith(join("node_modules", "@scope", "demo-pkg")), true);
    assert.equal(staged.staged, true);
  });

  it("npm 来源：装完找不到包目录时报错", async () => {
    await assert.rejects(
      stagePluginSource({
        source: { source: "npm", package: "missing-pkg" },
        stagingRoot: makeDir(),
        run: async () => ({ stdout: "" }),
      }),
      (error: unknown) => error instanceof SourceError && /找不到/.test(error.message),
    );
  });

  it("git 来源：浅克隆本地仓库，ref 与仓内 path 都生效", async () => {
    const repo = makeDir("plugin-repo-");
    makePackage(join(repo, "plugins", "demo"), "git-demo");
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    };
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "init");

    const staged = await stagePluginSource({
      source: { source: "git", url: repo, path: "plugins/demo", ref: "main" },
      stagingRoot: makeDir(),
    });

    assert.equal(
      existsSync(join(staged.path, PLUGIN_MANIFEST_DIRNAME, "plugin.json")),
      true,
      "仓内 path 指定的包目录被找到",
    );
  });

  it("git 来源：仓内路径不存在时报错", async () => {
    const repo = makeDir("plugin-repo-");
    makePackage(repo);
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    };
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "init");

    await assert.rejects(
      stagePluginSource({
        source: { source: "git", url: repo, path: "nope" },
        stagingRoot: makeDir(),
      }),
      (error: unknown) => error instanceof SourceError && /仓内路径不存在/.test(error.message),
    );
  });

  it("git 来源：仓内 path 越出克隆目录时拒绝（否则会把用户任意目录当插件根搬走）", async () => {
    const repo = makeDir("plugin-repo-");
    makePackage(repo);
    const outsider = makeDir("plugin-outsider-");
    writeFileSync(join(outsider, "keep.txt"), "用户的文件", "utf8");
    const git = (...args: string[]): void => {
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    };
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("add", "-A");
    git("commit", "-qm", "init");

    await assert.rejects(
      stagePluginSource({
        source: { source: "git", url: repo, path: join("..", basename(outsider)) },
        stagingRoot: makeDir(),
      }),
      (error: unknown) => error instanceof SourceError && /越出仓库/.test(error.message),
    );
    assert.equal(existsSync(join(outsider, "keep.txt")), true, "越界的目录必须原地不动");
  });

  it("git 来源：克隆失败原样抛出（不吞掉进程错误）", async () => {
    await assert.rejects(
      stagePluginSource({
        source: { source: "git", url: "https://example.invalid/nope.git" },
        stagingRoot: makeDir(),
        run: async () => {
          throw new Error("git clone failed: repository not found");
        },
      }),
      /repository not found/,
    );
  });
});
