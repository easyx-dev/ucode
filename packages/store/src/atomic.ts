import { open, rename, stat, truncate } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * 原子写与追加写（spec §3.4 第 2 条、§3.12）。
 *
 * - **非追加写必须原子**：临时文件 → fsync → rename。“要么完整生效、要么完全不生效”。
 * - **追加写是例外**（O_APPEND）：它不修改既有内容，因此不需要原子性，但**需要 fsync**——
 *   "先落盘再广播"里的"落盘"必须真的落到盘上，否则崩溃会让用户看到未持久化的内容。
 * - **截断是唯一允许的原地写**，且只在本实例持写权、尾部已知损坏时发生。
 */

/** 临时文件前缀：便于识别残留（一致性套件按此断言"成功路径不留残留"）。 */
export const TMP_PREFIX = ".tmp-";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // 某些平台/文件系统不支持对目录 fsync：尽力而为，不影响正确性。
  }
}

export async function writeFileAtomic(
  file: string,
  /** 文本或二进制（导出包是 gzip 字节，同样走"临时文件 + rename"的原子路径）。 */
  contents: string | Uint8Array,
  options: { mode?: number } = {},
): Promise<void> {
  const dir = dirname(file);
  const tmp = join(dir, `${TMP_PREFIX}${process.pid}-${randomSuffix()}`);
  const mode = options.mode ?? 0o600;
  const handle = await open(tmp, "w", mode);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, file);
  await fsyncDir(dir);
}

/** 追加一行并 fsync。调用方保证 line 以换行结束（一记录一行）。 */
export async function appendLine(file: string, line: string): Promise<void> {
  const handle = await open(file, "a", 0o600);
  try {
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * 处置崩溃尾部：若非完整行则截断到最后一个换行处。
 * 返回被截断的字节数（0 表示文件本来就是完整的）。
 */
export async function truncateToLastNewline(file: string): Promise<number> {
  const handle = await open(file, "r");
  let content: string;
  try {
    content = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
  if (content === "" || content.endsWith("\n")) return 0;
  const lastNewline = content.lastIndexOf("\n");
  const keep = lastNewline + 1; // 0 表示整文件都是残行
  await truncate(file, keep);
  return Buffer.byteLength(content, "utf8") - Buffer.byteLength(content.slice(0, keep), "utf8");
}

export async function fileSize(file: string): Promise<number> {
  return (await stat(file)).size;
}

/** 删除文件（用于让派生的索引下次被重建）。 */
export async function removeFile(file: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  await unlink(file).catch(() => undefined);
}
