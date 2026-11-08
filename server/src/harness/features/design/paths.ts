/**
 * 设计稿文件的落位、命名与项目内的清单口径。
 *
 * 文件里**不记任何会话信息**：稿子就是项目里一个普通文件，谁都可以打开它。
 * 服务端按**绝对路径**持有文档，会话只记「当前在改哪份」（见 `features/design/index.ts`）。
 *
 * 落位只有一个答案：项目设计稿目录（`<cwd>/<项目配置目录>/design`）。新稿的名字取会话标题的 slug
 * （`音乐 App 首页.design` 比一串 uuid 有用得多），重名只加序号——文件名是给人看的。
 */
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DESIGN_FILE_EXTENSION, DESIGN_FILE_TITLE_MAX_LENGTH } from "../../../constants/design";
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
 * 别的会话**已经占住**的文件名（还在只看未建文件）也算重名：两个会话分到同一个文件名，
 * 转一圈又变成「改的是同一份稿」。重名只加序号，不拼 uuid。
 */
export const defaultDesignPath = async (input: {
  cwd: string;
  title?: string | null;
  /** 已被别的会话占用的稿子路径；同目录下算重名 */
  used?: readonly string[];
}): Promise<string> => {
  const dir = designDirOf(input.cwd);
  const taken = new Set((await listDesignFiles(dir)).map((name) => name.toLowerCase()));
  for (const path of input.used ?? []) {
    if (dirname(path) === dir) taken.add(basename(path).toLowerCase());
  }
  const slug = slugOfDesignTitle(input.title);
  let candidate = `${slug}${DESIGN_FILE_EXTENSION}`;
  for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) {
    candidate = `${slug}-${index}${DESIGN_FILE_EXTENSION}`;
  }
  return join(dir, candidate);
};

/** 扫出来的一个设计稿文件 */
export type ProjectDesignFile = { path: string; name: string; updatedAt: string };

/**
 * 列出**本项目设计稿目录**里的稿子（按改动时间倒序，最近的在前）。
 *
 * 只认这一层目录，不递归整个项目：稿子散在项目各处是允许的（`design_open` 可以指任何
 * `.design`），但那些不是「本项目的稿」——递归会把别的会话的工作区（开发时 `APP_HOME`
 * 就在仓库里）、构建产物与临时目录里的残片一并算进来。
 */
export const listProjectDesignFiles = async (cwd: string): Promise<ProjectDesignFile[]> => {
  const dir = designDirOf(cwd);
  const names = await listDesignFiles(dir);
  const files = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      const stats = await stat(path).catch(() => null);
      return { path, name, updatedAt: (stats?.mtime ?? new Date(0)).toISOString() };
    }),
  );
  return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};
