/**
 * 单文件内容读取：预览器与服务端的公共入口。
 *
 * 先嗅探前若干字节判断是否二进制（含 NUL 即算）：文本按 UTF-8 内联、超限按上限截断；
 * 二进制按 base64 内联、超限则整块不给内容。全程只读需要的字节数，不会把大文件读进内存。
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { basename } from "node:path";

import { ERROR_CODES, type FsReadInput, type FsReadResponse } from "@ucode/contracts";

import {
  FS_BINARY_SNIFF_BYTES,
  FS_READ_BINARY_MAX_BYTES,
  FS_READ_TEXT_MAX_BYTES,
} from "../../constants";
import { resolveExistingPath } from "../../utils/path";
import { AppError } from "../response";

/** 从文件头读最多 `size` 字节；`readSync` 可能短读，循环补满 */
const readPrefix = (fd: number, size: number): Buffer => {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = readSync(fd, buffer, offset, size - offset, offset);
    if (read === 0) break;
    offset += read;
  }
  return buffer.subarray(0, offset);
};

export const readFileContent = (input: FsReadInput): FsReadResponse => {
  // 文件也要能读，因此显式关掉 directoryOnly
  const path = resolveExistingPath(input.path, false);
  const stats = statSync(path);
  if (!stats.isFile()) {
    throw new AppError(ERROR_CODES.notAFile, `不是普通文件：${input.path}`, 400, undefined, {
      path: input.path,
    });
  }

  const fd = openSync(path, "r");
  try {
    const sniffSize = Math.min(stats.size, FS_BINARY_SNIFF_BYTES);
    const binary = readPrefix(fd, sniffSize).includes(0);
    const limit = Math.min(
      input.maxBytes ?? Number.POSITIVE_INFINITY,
      binary ? FS_READ_BINARY_MAX_BYTES : FS_READ_TEXT_MAX_BYTES,
    );

    const base = {
      path,
      name: basename(path),
      size: stats.size,
      updatedAt: stats.mtime.toISOString(),
    };

    if (binary) {
      return stats.size > limit
        ? { ...base, kind: "binary", truncated: true }
        : {
            ...base,
            kind: "binary",
            base64: readPrefix(fd, stats.size).toString("base64"),
            truncated: false,
          };
    }

    const size = Math.min(stats.size, limit);
    return {
      ...base,
      kind: "text",
      text: readPrefix(fd, size).toString("utf8"),
      truncated: stats.size > size,
    };
  } finally {
    closeSync(fd);
  }
};
