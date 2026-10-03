/** mcp 域的响应模型：服务器条目与其配置视图 */
import type { McpServerInput } from "./input";

/** 单个 MCP 服务器视图；与入参同形，`env` / `headers` 明文回显 */
export type McpServerView = McpServerInput;

export type McpListResponse = {
  servers: McpServerView[];
  /** 配置文件绝对路径，供设置页展示与排查 */
  configPath: string;
  /** 读盘或解析失败的原因（坏 JSON、字段不合法）；空数组表示正常 */
  errors: string[];
};

export type McpWriteResponse = {
  server: McpServerView;
  configPath: string;
};

export type McpDeleteResponse = {
  /** 是否命中并删除了条目；目标不存在时为 false */
  removed: boolean;
  configPath: string;
};
