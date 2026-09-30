/**
 * Domain catalog (English): error text keyed by the Chinese source strings, one per `ERROR_CODES`.
 *
 * Keys must match `zh-CN.ts`; the code → key mapping lives in `src/error-messages.ts`.
 */
export default {
  请求参数无效: "Invalid request parameters",
  接口不存在: "No such API endpoint: {{path}}",
  内部错误: "Internal server error",
  会话正忙: "The session is busy. Retry later or use steer.",
  模型不可用: "Model unavailable: {{ref}}",
  尚未配置模型: "No model configured. Add a provider in settings first.",
  不支持该api测试: "Connectivity test does not support this API type: {{api}}",
  上游不可达: "Cannot reach {{url}}",
  上游错误: "Upstream returned HTTP {{status}}",
  配置文件解析失败: "Failed to parse the config file: {{path}}",
  路径不存在: "Path does not exist: {{path}}",
  目录已存在: "Directory already exists: {{path}}",
  创建目录失败: "Failed to create directory: {{path}}",
  项目不存在: "Project does not exist: {{path}}",
};
