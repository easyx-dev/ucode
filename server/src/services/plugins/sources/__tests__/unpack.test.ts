/** services/plugins/sources/unpack：zip 与 tgz 解包的越界防护与上限 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { zipSync } from "fflate";
import * as tar from "tar";

import { detectArchiveFormat, UnpackError, unpackArchive } from "../unpack";

const created: string[] = [];

const makeDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-unpack-"));
  created.push(dir);
  return dir;
};

/** 造一个 zip：键是归档内路径 */
const makeZip = (entries: Record<string, string>): Uint8Array =>
  zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, content]) => [name, new TextEncoder().encode(content)]),
    ),
  );

/** 造一个 tgz：先写文件再打包 */
const makeTgz = async (entries: Record<string, string>, makeLinks = false): Promise<Uint8Array> => {
  const source = makeDir();
  for (const [name, content] of Object.entries(entries)) {
    const path = join(source, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  if (makeLinks) {
    // 归档里放一条符号链接：解包必须拒它（否则链接可以指向包外）
    mkdirSync(join(source, "dir"), { recursive: true });
    writeFileSync(join(source, "dir", "real.txt"), "x", "utf8");
    symlinkSync("real.txt", join(source, "dir", "link.txt"));
  }
  const archive = join(makeDir(), "pkg.tgz");
  await tar.c(
    { gzip: true, file: archive, cwd: source },
    Object.keys(entries).concat(makeLinks ? ["dir"] : []),
  );
  return new Uint8Array(readFileSync(archive));
};

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("detectArchiveFormat", () => {
  it("先按扩展名，再按魔数", () => {
    assert.equal(detectArchiveFormat("https://x/plugin.zip", new Uint8Array()), "zip");
    assert.equal(detectArchiveFormat("https://x/plugin.tgz", new Uint8Array()), "tgz");
    assert.equal(detectArchiveFormat("https://x/plugin.tar.gz", new Uint8Array()), "tgz");
    assert.equal(detectArchiveFormat("https://x/download", new Uint8Array([0x50, 0x4b])), "zip");
    assert.equal(detectArchiveFormat("https://x/download", new Uint8Array([0x1f, 0x8b])), "tgz");
    assert.equal(detectArchiveFormat("https://x/download", new Uint8Array([1, 2])), null);
  });
});

describe("unpackArchive", () => {
  it("zip：正常解出目录结构", async () => {
    const target = makeDir();
    const result = await unpackArchive({
      data: makeZip({ "plugin.json": "{}", "skills/review/SKILL.md": "正文" }),
      format: "zip",
      targetDir: target,
    });

    assert.equal(result.files, 2);
    assert.equal(readFileSync(join(target, "skills", "review", "SKILL.md"), "utf8"), "正文");
  });

  it("tgz：正常解出目录结构，且不留归档本体", async () => {
    const target = makeDir();
    const result = await unpackArchive({
      data: await makeTgz({ "plugin.json": "{}" }),
      format: "tgz",
      targetDir: target,
    });

    assert.equal(result.files, 1);
    assert.equal(readFileSync(join(target, "plugin.json"), "utf8"), "{}");
    assert.equal(existsSync(join(target, ".plugin-archive.tgz")), false);
  });

  it("zip 里的越界条目被拒", async () => {
    const target = makeDir();
    await assert.rejects(
      unpackArchive({
        data: makeZip({ "../escape.txt": "x", "plugin.json": "{}" }),
        format: "zip",
        targetDir: target,
      }),
      (error: unknown) => error instanceof UnpackError && /路径越界/.test(error.message),
    );
    assert.equal(existsSync(join(target, "..", "escape.txt")), false);
  });

  it("绝对路径条目被拒", async () => {
    const target = makeDir();
    await assert.rejects(
      unpackArchive({
        data: makeZip({ "/etc/passwd": "x" }),
        format: "zip",
        targetDir: target,
      }),
      (error: unknown) => error instanceof UnpackError,
    );
  });

  // 造归档用的符号链接在 Windows 上需要开发者模式或管理员权限
  it("tgz 里的符号链接被拒", { skip: process.platform === "win32" }, async () => {
    const target = makeDir();
    await assert.rejects(
      unpackArchive({
        data: await makeTgz({ "plugin.json": "{}" }, true),
        format: "tgz",
        targetDir: target,
      }),
      (error: unknown) => error instanceof UnpackError && /链接条目/.test(error.message),
    );
  });

  it("不是压缩体时报错而不是产出一个空目录", async () => {
    const target = makeDir();
    await assert.rejects(
      unpackArchive({ data: new Uint8Array([1, 2, 3]), format: "zip", targetDir: target }),
      (error: unknown) => error instanceof UnpackError,
    );
  });
});
