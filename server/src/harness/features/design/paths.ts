/**
 * 设计稿文件的落位与命名。
 *
 * 文件里**不记任何会话信息**：稿子就是项目里一个普通文件，谁都可以打开它。
 * 服务端按**绝对路径**持有文档，会话只记「当前在改哪份」（见 `features/design/index.ts`）。
 *
 * 这里只回答一个问题：一个还没打开过任何稿子的会话，第一份稿落在哪。
 * 名字取会话标题的 slug（`音乐 App 首页.design` 比一串 uuid 有用得多），重名只加序号——文件名是给人看的。
 */
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  DESIGN_FILE_EXTENSION,
  DESIGN_FILE_SCAN_MAX,
  DESIGN_FILE_SCAN_MAX_DEPTH,
  DESIGN_FILE_TITLE_MAX_LENGTH,
} from "../../../constants/design";
import { DESIGN_DIRNAME, PROJECT_CONFIG_DIRNAME } from "../../../constants/dirs";

/** 没标题时的兜底文件名（会话还在起名阶段就先出了稿） */
const FALLBACK_TITLE = "设计稿";

/** 一份设计稿落在哪个目录：`<cwd>/<项目配置目录>/design` */
export const designDirOf = (cwd: string): string =>
  join(cwd, PROJECT_CONFIG_DIRNAME, DESIGN_DIRNAME);

/**
 * 会话标题 → 文件名主体。
 *
 * 保留中文与字母数字（标题本来就是给人看的），把会破坏文件名的字符与空白折成 `-`；
 * 全是符号、或超长时截断。结果为空就退回 `设计稿`。
 */
export const slugOfDesignTitle = (title: string | null | undefined): string => {
  const trimmed = (title ?? "").trim();
  if (trimmed === "") return FALLBACK_TITLE;
  const slug = trimmed
    .replaceAll(/[\s/\\:*?"<>|\p{Cc}]+/gu, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-.]+|[-.]+$/g, "")
    .slice(0, DESIGN_FILE_TITLE_MAX_LENGTH)
    .replaceAll(/[-.]+$/g, "");
  return slug === "" ? FALLBACK_TITLE : slug;
};

/** 目录里已有的设计稿文件名（目录不存在算空） */
export const listDesignFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(DESIGN_FILE_EXTENSION))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

/**
 * 一个新稿的落点：`<cwd>/<项目配置目录>/design/<标题 slug>.design`。
 *
 * 已存在的同名文件不复用——那是别人（或别的对话）的稿，直接覆盖看起来就像「我的稿子被清了」。
 * 重名只加序号，不拼 uuid。
 */
export const defaultDesignPath = async (input: {
  cwd: string;
  title?: string | null;
}): Promise<string> => {
  const dir = designDirOf(input.cwd);
  const taken = new Set((await listDesignFiles(dir)).map((name) => name.toLowerCase()));
  const slug = slugOfDesignTitle(input.title);
  let candidate = `${slug}${DESIGN_FILE_EXTENSION}`;
  for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) {
    candidate = `${slug}-${index}${DESIGN_FILE_EXTENSION}`;
  }
  return join(dir, candidate);
};

/** 扫出来的一个设计稿文件 */
export type ProjectDesignFile = { path: string; name: string; updatedAt: string };

/** 递归扫时跳过的目录：依赖、版本库与产物目录里不会有用户的稿子 */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

/**
 * 列出项目里的全部设计稿文件（按改动时间倒序，最近的在前）。
 *
 * `.design` 只是文件，可能散在项目任何位置——所以是递归扫，不是只认默认目录；
 * 上限按条数（`DESIGN_FILE_SCAN_MAX`）与深度（`DESIGN_FILE_SCAN_MAX_DEPTH`）兜住，避免大仓库拖死侧栏。
 */
export const listProjectDesignFiles = async (
  cwd: string,
): Promise<{ files: ProjectDesignFile[]; truncated: boolean }> => {
  const files: ProjectDesignFile[] = [];
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > DESIGN_FILE_SCAN_MAX_DEPTH) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.length === 0) return;
    for (const entry of entries) {
      if (files.length >= DESIGN_FILE_SCAN_MAX) {
        truncated = true;
        return;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(DESIGN_FILE_EXTENSION)) continue;
      const stats = await stat(path).catch(() => null);
      files.push({
        path,
        name: entry.name,
        updatedAt: (stats?.mtime ?? new Date(0)).toISOString(),
      });
    }
  };

  await walk(cwd, 0);
  files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { files, truncated };
};
