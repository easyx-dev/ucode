import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { removeFile, writeFileAtomic } from "../../storage/index.ts";
import {
  isSafeMemoryName,
  MEMORY_INDEX_FILE,
  type MemoryType,
  memoryFactPath,
  memoryIndexPath,
} from "./paths.ts";
import {
  buildIndexContent,
  type MemoryFact,
  parseMemoryFact,
  serializeMemoryFact,
} from "./record.ts";

/**
 * 项目记忆的读写（F-2.5）。
 *
 * 真相是**目录里的 Markdown 文件**：`MEMORY.md` 只是派生索引，任何时候都能由条目重建
 * （与数据层"索引是派生数据"的处置一致——索引坏了不影响真相）。
 */

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/** 列出全部条目，按名字排序。目录不存在时返回空表（记忆是"有才读"的可选能力）。 */
export async function listMemoryFacts(dir: string): Promise<MemoryFact[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const facts: MemoryFact[] = [];
  for (const name of names) {
    if (!name.endsWith(".md") || name === MEMORY_INDEX_FILE) continue;
    const file = join(dir, name);
    try {
      const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
      facts.push(parseMemoryFact(file, raw, info.mtime.toISOString()));
    } catch {
      // 单个文件读失败不该让整次读取失败（可能正被其他进程改写）。
    }
  }
  return facts.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readMemoryFact(dir: string, name: string): Promise<MemoryFact | null> {
  let file: string;
  try {
    file = memoryFactPath(dir, name);
  } catch {
    return null;
  }
  try {
    const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return parseMemoryFact(file, raw, info.mtime.toISOString());
  } catch {
    return null;
  }
}

export type WriteMemoryInput = {
  name: string;
  description: string;
  type?: MemoryType;
  body: string;
};

export async function writeMemoryFact(dir: string, input: WriteMemoryInput): Promise<MemoryFact> {
  if (!isSafeMemoryName(input.name)) {
    throw new Error(
      `非法的记忆条目名：${input.name}（只允许小写字母、数字、._-，且不能叫 MEMORY）。`,
    );
  }
  await ensureDir(dir);
  const file = memoryFactPath(dir, input.name);
  const type: MemoryType = input.type ?? "project";
  const content = serializeMemoryFact({
    name: input.name,
    description: input.description,
    type,
    body: input.body,
  });
  await writeFileAtomic(file, content, { mode: 0o600 });
  await rebuildMemoryIndex(dir);
  const info = await stat(file);
  return parseMemoryFact(file, content, info.mtime.toISOString());
}

export async function deleteMemoryFact(dir: string, name: string): Promise<boolean> {
  let file: string;
  try {
    file = memoryFactPath(dir, name);
  } catch {
    return false;
  }
  try {
    await removeFile(file);
  } catch {
    return false;
  }
  await rebuildMemoryIndex(dir);
  return true;
}

export async function readMemoryIndex(dir: string): Promise<string | null> {
  try {
    return await readFile(memoryIndexPath(dir), "utf8");
  } catch {
    return null;
  }
}

/** 由条目重建 `MEMORY.md`（索引是派生数据，可随时重算）。 */
export async function rebuildMemoryIndex(dir: string): Promise<string> {
  await ensureDir(dir);
  const facts = await listMemoryFacts(dir);
  const content = buildIndexContent(facts);
  await writeFileAtomic(memoryIndexPath(dir), content, { mode: 0o600 });
  return content;
}
