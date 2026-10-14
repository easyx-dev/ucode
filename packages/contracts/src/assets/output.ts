/** assets 域的响应模型：三类资产的列表项、详情与写入 / 删除结果 */
import type { AssetKind, AssetScope, CommandAssetSource, ThinkingLevel } from "../constants";

/**
 * 角色的 frontmatter `mode`：`primary` 作会话主 agent、`subagent` 由 `subagent` 工具委派、
 * `all` 两者兼作。
 */
export type AssetAgentMode = "primary" | "subagent" | "all";

/** 列表里的一项资产；只读来源（插件 / 内置 / `.agents` 兼容目录）的 `editable` 为 false */
export type AssetView = {
  kind: AssetKind;
  /** 资产名：角色的 slug、技能的目录名、命令的文件名 */
  name: string;
  /** 展示名：角色取 frontmatter `name`，其余同 `name` */
  label: string;
  /** 一句话说明；解析失败时为空串 */
  description: string;
  /** 来源档位，顺序即同名优先级（前者胜） */
  source: CommandAssetSource;
  /** 是否可编辑（全局 / 项目两档为 true） */
  editable: boolean;
  /** 可写档的落点作用域；只读来源缺省 */
  scope?: AssetScope;
  /** 磁盘路径；内置命令这类没有真身的项给 `builtin:<name>` */
  path: string;
  /** 是否生效：同名时优先级最高者为 true，被压住的为 false */
  active: boolean;
  /** 压住它的那一条的路径；仅 `active` 为 false 时有 */
  overriddenBy?: string;
};

/** 解析失败的条目：文件保留在磁盘上，只有这一条被跳过 */
export type AssetError = {
  kind: AssetKind;
  name: string;
  path: string;
  reason: string;
};

export type AssetsListResponse = {
  agents: AssetView[];
  skills: AssetView[];
  commands: AssetView[];
  /** 无法解析 / 被跳过的条目；模型用 write 直接写坏的文件也在这里暴露 */
  errors: AssetError[];
};

/** 一条资产的详情：表单字段 + 正文 + 写回所需的原始行 */
export type AssetDetail = {
  kind: AssetKind;
  name: string;
  label: string;
  description: string;
  source: CommandAssetSource;
  editable: boolean;
  scope?: AssetScope;
  path: string;
  /** 角色专有字段 */
  mode?: AssetAgentMode;
  tools?: string[];
  model?: string;
  thinking?: ThinkingLevel;
  advertise?: boolean;
  hidden?: boolean;
  /** 命令专有字段 */
  argumentHint?: string;
  /** frontmatter 之外的提示词正文 */
  body: string;
  /** 技能目录内的其余文件（相对技能目录）；删除时会一并删掉 */
  files?: string[];
  /** 未建模的 frontmatter 行；保存时原样回传 */
  extraLines: string[];
  /** 非阻断的提示：技能名与目录名不一致、命令缺 description 等 */
  warnings: string[];
};

export type AssetSaveResponse = {
  kind: AssetKind;
  name: string;
  path: string;
  /** 本次是新建（true）还是覆盖已有文件（false） */
  created: boolean;
};

export type AssetDeleteResponse = {
  kind: AssetKind;
  name: string;
  path: string;
  /** 是否命中并删除；目标不存在时为 false */
  removed: boolean;
};
