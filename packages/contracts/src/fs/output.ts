/** fs 域的响应模型：目录条目、新建结果与文件内容 */
import type { ListResult } from "../common";
import type { FsEntryType, FsReadKind } from "../constants";

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

/**
 * 单文件内容。`kind` 由服务端判定（前若干字节含 NUL 即二进制），客户端据此选渲染器：
 * 文本给 `text`，二进制给 `base64`；两者都在超出内联上限时缺省，由 `truncated` 标注。
 */
export type FsReadResponse = {
  /** 已归一化的绝对路径 */
  path: string;
  /** 文件名字（路径末段），供预览器 tab 直接使用 */
  name: string;
  /** 字节数 */
  size: number;
  updatedAt: string;
  kind: FsReadKind;
  /** UTF-8 文本；`kind` 为 `binary` 或超出文本内联上限时缺省 */
  text?: string;
  /** base64 字节；`kind` 为 `text` 或超出二进制内联上限时缺省 */
  base64?: string;
  /** 内容是否因体积上限被截断（二进制超限时为 true 且整块不给） */
  truncated: boolean;
};
