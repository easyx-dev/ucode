/**
 * MCP 工具的权限兜底：按工具自带的 annotations 判定读写，仅在没有显式规则命中时生效。
 *
 * annotations 由 MCP 服务器作者声明、未经校验，所以「只读」才放行，其余一律审批；
 * 用户仍可用显式规则或会话恒允覆盖（规则最后命中者胜的语义不变）。
 */
import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import type { PermissionAction } from "@ucode/contracts";

/** 审批弹窗里的参数摘要长度上限，避免大 payload 撑爆对话框 */
const MCP_SUBJECT_MAX_CHARS = 200;

export type McpPermissionVerdict = {
  action: PermissionAction;
  /** 需要确认的原因，拼进审批弹窗的展示文本 */
  note: string;
};

export const mcpPermission = (annotations: ToolAnnotations | undefined): McpPermissionVerdict => {
  if (annotations?.readOnlyHint === true) {
    return { action: "allow", note: "该 MCP 工具声明为只读" };
  }
  if (annotations?.destructiveHint === true) {
    return { action: "ask", note: "该 MCP 工具可能删除或覆盖数据" };
  }
  if (annotations?.openWorldHint === true) {
    return { action: "ask", note: "该 MCP 工具会访问外部环境" };
  }
  return { action: "ask", note: "该 MCP 工具可能产生副作用" };
};

/** pi 对 MCP 工具的命名：`mcp__<server>__<tool>` */
export const isMcpToolName = (name: string): boolean => name.startsWith("mcp__");

/** 审批展示文本：入参 JSON 摘要 + 判定原因；空参数只留原因 */
export const mcpSubject = (input: Record<string, unknown>, note: string): string => {
  let args = "";
  try {
    const serialized = JSON.stringify(input);
    if (serialized && serialized !== "{}") args = serialized;
  } catch {
    // 参数不可序列化（循环引用等）时只展示原因
  }
  const text = args ? `${args}（${note}）` : note;
  return text.length > MCP_SUBJECT_MAX_CHARS ? `${text.slice(0, MCP_SUBJECT_MAX_CHARS)}…` : text;
};
