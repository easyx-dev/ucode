/** assets 域的请求 zod 模型：设置页对角色 / 技能 / 命令三类资产的查、读、写、删 */
import { z } from "zod";

import {
  ASSET_BODY_MAX_LENGTH,
  ASSET_KINDS,
  ASSET_NAME_MAX_LENGTH,
  ASSET_SCOPES,
  THINKING_LEVELS,
} from "../constants";
import { sessionIdSchema } from "../sessions/input";

/**
 * 目录口径与 agents / commands 一致：优先按 `sessionId` 解析工作目录，其次用 `cwd`；
 * 两者都缺省时服务端回落到助理工作区（此时项目档不可用）。
 */
const assetTargetFields = {
  sessionId: sessionIdSchema.optional(),
  cwd: z.string().min(1).optional(),
};

/** 资产名：角色的 slug、技能的目录名、命令的文件名；字符集由服务端按 kind 二次校验 */
const assetNameSchema = z.string().min(1).max(ASSET_NAME_MAX_LENGTH);

const assetRefFields = { ...assetTargetFields, kind: z.enum(ASSET_KINDS) };

/** 列举三类资产：含只读来源与被同名压住的条目，另附解析失败的条目 */
export const assetsListInputSchema = z.object({ ...assetTargetFields });

/** 读一条资产的详情：按磁盘路径定位，路径必须落在该 kind 的资产目录内 */
export const assetsReadInputSchema = z.object({ ...assetRefFields, path: z.string().min(1) });

/**
 * 新建或覆盖一条资产。落点由 `scope` 决定而**不接受路径**——
 * 路径由服务端按 kind + scope 解析并校验，避免把写接口变成任意文件写入。
 */
export const assetsSaveInputSchema = z.object({
  ...assetRefFields,
  name: assetNameSchema,
  scope: z.enum(ASSET_SCOPES),
  /** 角色的展示名（frontmatter `name`）；缺省用文件名 */
  label: z.string().trim().min(1).max(120).optional(),
  /** 一句话说明；角色与技能必填，命令可缺省（pi 会取正文首行） */
  description: z.string().trim().min(1).max(1024).optional(),
  /** 角色类别；缺省 subagent */
  mode: z.enum(["primary", "subagent", "all"]).optional(),
  /** 角色工具档位：空数组或 `["inherit"]` 表示继承父会话，其余为工具名白名单 */
  tools: z.array(z.string()).optional(),
  model: z.string().trim().min(1).optional(),
  thinking: z.enum(THINKING_LEVELS).optional(),
  advertise: z.boolean().optional(),
  hidden: z.boolean().optional(),
  /** 命令的参数提示（frontmatter `argument-hint`） */
  argumentHint: z.string().trim().min(1).max(120).optional(),
  /** frontmatter 之外的提示词正文 */
  body: z.string().min(1).max(ASSET_BODY_MAX_LENGTH),
  /**
   * 未建模的 frontmatter 行，读详情时给出、保存时原样写回。
   * 传文本而不是传值：服务端只做行拼接，不替用户重新序列化自己加的字段。
   */
  extraLines: z.array(z.string()).optional(),
});

/** 删除一条资产：同样按磁盘路径定位，只读来源拒绝 */
export const assetsDeleteInputSchema = z.object({ ...assetRefFields, path: z.string().min(1) });

export type AssetsListRequest = z.input<typeof assetsListInputSchema>;
export type AssetsListInput = z.infer<typeof assetsListInputSchema>;
export type AssetsReadRequest = z.input<typeof assetsReadInputSchema>;
export type AssetsReadInput = z.infer<typeof assetsReadInputSchema>;
export type AssetsSaveRequest = z.input<typeof assetsSaveInputSchema>;
export type AssetsSaveInput = z.infer<typeof assetsSaveInputSchema>;
export type AssetsDeleteRequest = z.input<typeof assetsDeleteInputSchema>;
export type AssetsDeleteInput = z.infer<typeof assetsDeleteInputSchema>;
