/**
 * Domain catalog (English): error text keyed by the Chinese source strings, one per `ERROR_CODES`.
 *
 * Keys are the full Chinese copy (with `{{placeholders}}`); the matching `zh-CN.ts` is empty
 * because a missing key renders as the key itself. Keys must exist here or `pnpm check` fails;
 * the code → key mapping lives in `src/error-messages.ts`.
 */
export default {
  请求参数无效: "Invalid request parameters",
  "请求超时，请重试": "The request timed out. Please try again.",
  "接口不存在：{{path}}": "No such API endpoint: {{path}}",
  服务内部错误: "Internal server error",
  "会话正在生成，请先中断或等本轮结束":
    "The session is generating. Interrupt it or wait for this turn to finish.",
  "压缩失败：{{reason}}": "Compaction failed: {{reason}}",
  "模型不可用：{{ref}}": "Model unavailable: {{ref}}",
  "尚未配置模型，请先在设置里添加 provider":
    "No model configured. Add a provider in settings first.",
  "连通性测试不支持该 api 类型：{{api}}":
    "Connectivity test does not support this API type: {{api}}",
  "无法连接 {{url}}": "Cannot reach {{url}}",
  "上游返回 HTTP {{status}}": "Upstream returned HTTP {{status}}",
  "配置文件解析失败：{{path}}": "Failed to parse the config file: {{path}}",
  "登录已失效，请重新登录": "Your session has expired. Please sign in again.",
  密码错误: "Incorrect password",
  没有权限执行该操作: "You do not have permission to do this",
  配对链接无效或已使用: "This pairing link is invalid or has already been used",
  "配对链接已过期，请重新生成": "This pairing link has expired. Generate a new one.",
  "操作过于频繁，请稍后再试": "Too many attempts. Please try again later.",
  "路径不存在：{{path}}": "Path does not exist: {{path}}",
  "目录已存在：{{path}}": "Directory already exists: {{path}}",
  "创建目录失败：{{path}}": "Failed to create directory: {{path}}",
  "项目不存在：{{path}}": "Project does not exist: {{path}}",
  "不是普通文件：{{path}}": "Not a regular file: {{path}}",
  "资产名不合法：{{reason}}": "Invalid asset name: {{reason}}",
  "该来源的资产不可编辑：{{path}}": "Assets from this source are read-only: {{path}}",
  "资产内容校验失败：{{reason}}": "Asset content is invalid: {{reason}}",
  "目录不在 git 仓库内：{{path}}": "Directory is not inside a git repository: {{path}}",
  "未找到 git 可执行文件": "No git executable found",
  "git 执行失败": "git command failed",
  终端不存在或已结束: "The terminal does not exist or has already exited",
  终端数量已达上限: "Terminal limit reached for this directory",
  "图片无效：{{reason}}": "Invalid image: {{reason}}",
  "附件超过大小上限（{{max}}）": "Attachment exceeds the size limit ({{max}})",
  "插件不存在：{{id}}": "No such plugin: {{id}}",
  "插件清单无效：{{path}}": "Invalid plugin manifest: {{path}}",
  "插件组件路径无效：{{path}}": "Invalid plugin component path: {{path}}",
  "插件来源不受支持：{{source}}": "Unsupported plugin source: {{source}}",
  "市场配置无效：{{reason}}": "Invalid marketplace: {{reason}}",
};
