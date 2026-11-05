/**
 * memory 域的响应模型：项目级记忆的浏览与维护（改 / 删已有条目）。
 *
 * 记忆按会话工作目录归属，磁盘上是 `$APP_HOME/app/memory/projects/<末段-哈希>/` 一个项目一个目录
 * （见 `server/src/harness/features/memory/paths.ts`）。路径由目录名的哈希反查得到，
 * 反查不到（原会话已删掉、目录被手工搬过）时 `path` 为 null——内容照列，只是标不出是哪个项目。
 *
 * 新增不在这一域：让模型「记住」才是入口（`remember` 工具与自动回顾），界面只维护已有条目。
 */
import type { ListResult } from "../common";

/** 一条记忆的目录条目：标题与描述来自 `MEMORY.md` 索引行 */
export type MemoryEntryView = {
  /** 事实文件名（仅文件名，与索引同目录） */
  file: string;
  title: string;
  /** 索引里那一行末尾的描述；空串表示没写 */
  description: string;
};

/** 一个项目的记忆：目录、反查到的项目路径与条目清单 */
export type MemoryProjectView = {
  /** 记忆目录名（位于 `memory/projects` 下），后续 `read` 按它寻址 */
  dir: string;
  /** 反查到的项目目录；反查不到时为 null */
  path: string | null;
  /** 项目展示名（用户在侧栏改过的名字）；没有项目行时为 null */
  name: string | null;
  /** 该项目当下是否生效：项目级覆盖优先，未设过时跟随全局开关 */
  enabled: boolean;
  entries: MemoryEntryView[];
};

export type MemoryListResponse = ListResult & {
  /** 有记忆的项目，按记忆目录名排序 */
  projects: MemoryProjectView[];
};

/** 一条记忆的正文（`read` / `update` 的响应） */
export type MemoryFactView = {
  dir: string;
  file: string;
  title: string;
  /** 事实文件全文（含首行的标题与结尾换行） */
  content: string;
};

/** 删一条记忆的回执 */
export type MemoryDeleteResponse = {
  dir: string;
  file: string;
  /** 是否命中并删除；目标已不存在时为 false */
  removed: boolean;
};
