/**
 * 压缩包解包：zip（fflate）与 tgz（tar），带体积 / 条目上限与路径穿越防护。
 *
 * 包是**外部不可信内容**，所以这些一律按拒绝处理：越界路径（绝对路径、`..` 段）、
 * 符号链接与硬链接、超过上限（条目数 / 总量）。不做「跳过继续」——半截包比失败更难排查。
 */
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { type Unzipped, unzipSync } from "fflate";
import * as tar from "tar";

import {
  PLUGIN_PACKAGE_MAX_BYTES,
  PLUGIN_UNPACK_MAX_BYTES,
  PLUGIN_UNPACK_MAX_ENTRIES,
} from "../../../constants/plugins";
import { isInsidePath } from "../../../platform/paths";

/** 解包失败：越界、超限、格式不对都归这一类，由调用方转成来源无效的失败 */
export class UnpackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnpackError";
  }
}

export type UnpackResult = {
  files: number;
  bytes: number;
};

/** 归档里的路径是否可用：相对、无 `..` 段、不指向绝对路径 */
const isSafeEntryPath = (name: string): boolean => {
  if (!name || name.startsWith("/") || /^[A-Za-z]:[\\/]/.test(name)) return false;
  return !name.split(/[\\/]/).includes("..");
};

/**
 * 归一化后的落点；越界即抛 `UnpackError`。
 *
 * 前缀比较走 `isInsidePath`（带分隔符、按运行平台）：手拼 `${root}/` 在 Windows 上恒不匹配
 * ——`resolve` 产出的是反斜杠，于是每个条目都被判成越界、zip 来源整条装不上。
 */
const resolveEntryPath = (targetDir: string, name: string): string => {
  if (!isSafeEntryPath(name)) throw new UnpackError(`归档条目路径越界：${name}`);
  const root = resolve(targetDir);
  const path = resolve(root, ...name.split(/[\\/]/));
  if (!isInsidePath(root, path)) {
    throw new UnpackError(`归档条目逃出目标目录：${name}`);
  }
  return path;
};

const writeBytes = (path: string, content: Uint8Array): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

/** 解 zip：fflate 的 filter 在解压前跑，越界与超限的条目不会被解出来 */
const unpackZip = (data: Uint8Array, targetDir: string): UnpackResult => {
  let entries = 0;
  let total = 0;
  /** 第一条问题：**不在 filter 里抛**（过滤器在解压循环内部调用，抛出去会变成未捕获异常） */
  let rejected: string | null = null;

  let files: Unzipped;
  try {
    files = unzipSync(data, {
      filter: (entry) => {
        if (rejected) return false;
        entries += 1;
        if (entries > PLUGIN_UNPACK_MAX_ENTRIES) {
          rejected = `归档条目数超过上限（${PLUGIN_UNPACK_MAX_ENTRIES}）`;
          return false;
        }
        const isDirectory = entry.name.endsWith("/");
        if (!isDirectory) total += entry.originalSize;
        if (total > PLUGIN_UNPACK_MAX_BYTES) {
          rejected = `解包后总量超过上限（${PLUGIN_UNPACK_MAX_BYTES} 字节）`;
          return false;
        }
        if (!isSafeEntryPath(entry.name)) {
          rejected = `归档条目路径越界：${entry.name}`;
          return false;
        }
        return !isDirectory;
      },
    });
  } catch (error) {
    throw new UnpackError(
      `zip 解包失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (rejected) throw new UnpackError(rejected);

  let bytes = 0;
  for (const [name, content] of Object.entries(files)) {
    writeBytes(resolveEntryPath(targetDir, name), content);
    bytes += content.byteLength;
  }
  return { files: Object.keys(files).length, bytes };
};

/** 解 tgz：归档先落临时文件，逐条目校验后再由 tar 落盘 */
const unpackTar = async (data: Uint8Array, targetDir: string): Promise<UnpackResult> => {
  const archivePath = join(targetDir, ".plugin-archive.tgz");
  writeFileSync(archivePath, data);

  let entries = 0;
  let bytes = 0;
  /** 与 zip 同理：在 filter 里抛会从流的事件回调里冒出去，变成未捕获异常 */
  let rejected: string | null = null;
  try {
    await tar.x({
      file: archivePath,
      cwd: targetDir,
      filter: (path, entry) => {
        if (rejected) return false;
        entries += 1;
        if (entries > PLUGIN_UNPACK_MAX_ENTRIES) {
          rejected = `归档条目数超过上限（${PLUGIN_UNPACK_MAX_ENTRIES}）`;
          return false;
        }
        // `filter` 的第二个参数可能是 ReadEntry 也可能是 Stats：只有前者带 `type`
        const type = "type" in entry ? entry.type : undefined;
        if (type === "SymbolicLink" || type === "Link") {
          rejected = `归档含链接条目，已拒绝：${path}`;
          return false;
        }
        if (!isSafeEntryPath(path)) {
          rejected = `归档条目路径越界：${path}`;
          return false;
        }
        bytes += entry.size ?? 0;
        if (bytes > PLUGIN_UNPACK_MAX_BYTES) {
          rejected = `解包后总量超过上限（${PLUGIN_UNPACK_MAX_BYTES} 字节）`;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    throw new UnpackError(
      `tgz 解包失败：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    // 归档本体不留在目标目录：它会污染内容哈希与组件扫描
    rmSync(archivePath, { force: true });
  }
  if (rejected) throw new UnpackError(rejected);
  return { files: entries, bytes };
};

/** 按扩展名挑格式；认不出来时按内容魔数兜底；都不匹配返回 null（不是压缩体） */
export const detectArchiveFormat = (url: string, data: Uint8Array): "zip" | "tgz" | null => {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (path.endsWith(".zip")) return "zip";
  if (path.endsWith(".tgz") || path.endsWith(".tar.gz")) return "tgz";
  if (data[0] === 0x50 && data[1] === 0x4b) return "zip";
  if (data[0] === 0x1f && data[1] === 0x8b) return "tgz";
  return null;
};

/** 解包到目标目录；压缩体超过上限直接拒 */
export const unpackArchive = async (input: {
  data: Uint8Array;
  format: "zip" | "tgz";
  targetDir: string;
}): Promise<UnpackResult> => {
  if (input.data.byteLength > PLUGIN_PACKAGE_MAX_BYTES) {
    throw new UnpackError(`压缩体超过上限（${PLUGIN_PACKAGE_MAX_BYTES} 字节）`);
  }
  statSync(input.targetDir);
  return input.format === "zip"
    ? unpackZip(input.data, input.targetDir)
    : await unpackTar(input.data, input.targetDir);
};
