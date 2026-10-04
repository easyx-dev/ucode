/** fs 域的响应模型：目录条目与新建结果 */
import type { ListResult } from "../common";
import type { FsEntryType } from "../constants";

export type FsEntry = {
  name: string;
  /** 绝对路径 */
  path: string;
  type: FsEntryType;
  /** 字节数；目录为 0 */
  size: number;
  updatedAt: string;
};

export type FsListResponse = ListResult & {
  /** 当前目录的绝对路径 */
  path: string;
  /** 上级目录绝对路径；根目录为 null */
  parent: string | null;
  /** 服务端固定排序：目录在前，各自按名称 */
  entries: FsEntry[];
};

export type FsMkdirResponse = {
  /** 已创建目录的绝对路径 */
  path: string;
};

/** 文件检索结果；不是 ListResult（无 `total`），条数上限由 `truncated` 表达 */
export type FsSearchResponse = {
  /** 检索根目录的绝对路径 */
  path: string;
  /** 命中条目，服务端固定排序（目录在前，各自按名称） */
  entries: FsEntry[];
  /** 是否因条数上限被截断 */
  truncated: boolean;
};
