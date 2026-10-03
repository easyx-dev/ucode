/**
 * Product UI catalog (English): interface vocabulary shared by web / Electron / TUI.
 *
 * A few browser/desktop-only keys (theme, Shift+Enter, starter suggestions) go unused by a
 * TUI — ignore them. Surface-specific extras go through `createI18n`'s `appCatalogs`.
 * Keys are the Simplified-Chinese source strings (see `zh-CN.ts`); keys must match `zh-CN.ts`
 * and must not collide with common/domain — `scripts/verify` fails on drift.
 */
export default {
  // Common
  会话: "Sessions",
  "加载中…": "Loading…",
  暂无会话: "No sessions",
  新建: "New",
  新建会话: "New session",
  新会话: "New session",
  搜索会话: "Search sessions",
  设置: "Settings",
  取消: "Cancel",
  保存: "Save",
  重命名: "Rename",
  删除: "Delete",
  更多操作: "More actions",
  未选择会话: "No session selected",
  生成中: "Generating",
  中文: "中文",

  // Chat header
  未配置模型: "No model configured",
  去设置: "Open settings",
  重建运行时: "Rebuild runtime",
  "重建运行时.说明": "Discard in-memory sessions and rebuild the runtime from the current config",

  // Settings dialog
  "设置.说明":
    "Appearance, model and web search configuration. Saving rebuilds the model runtime; leave apiKey blank to keep the saved key.",
  保存并生效: "Save and apply",
  外观: "Appearance",
  模型: "Models",
  默认值: "Defaults",
  "供应商.空态":
    "No provider configured yet. Pick one from the catalog below, or add a custom provider.",
  添加自定义供应商: "Add custom provider",

  // Web search
  联网搜索: "Web search",
  搜索服务商: "Search provider",
  "搜索服务商.说明": "Which search API the websearch tool calls.",
  "搜索key.说明":
    "Leave blank to keep the saved key; without a key the websearch tool returns a readable error.",
  实例地址: "Instance URL",
  "实例地址.说明":
    "URL of your SearXNG instance; enable JSON output in settings.yml (add json to search.formats).",

  // Memory
  记忆: "Memory",
  项目记忆: "Project memory",
  "项目记忆.说明":
    "When on, each conversation is reviewed in the background and durable facts are saved per project; later sessions in the same project load them automatically. Memory is stored locally and isolated by project directory.",
  开启: "On",

  // Appearance
  界面主题: "Theme",
  "界面主题.说明":
    "Dark mode mirrors the light palette one-to-one. Changes apply immediately and are remembered.",
  浅色: "Light",
  深色: "Dark",
  跟随系统: "System",
  语言: "Language",
  "语言.说明": "Interface language. Changes take effect immediately and are remembered.",

  // Provider catalog
  接入内置供应商: "Add a built-in provider",
  可选数量: "{{n}} available",
  "搜索供应商，如 deepseek": "Search providers, e.g. deepseek",
  "没有匹配的供应商。": "No matching provider.",
  已加入: "Added",
  模型数量: "{{n}} models",

  // Reasoning levels
  关闭: "Off",
  极少: "Minimal",
  低: "Low",
  中: "Medium",
  高: "High",
  极高: "Very high",
  最高: "Max",
  推理等级映射: "Reasoning level map",
  添加等级: "Add level",
  "推理等级.空态": "Unspecified levels use the vendor default; all 7 levels are usable.",
  推理等级: "Reasoning level",
  思考档位: "Reasoning level",
  厂商取值: "Vendor value; blank = unsupported",
  "厂商取值.aria": "Vendor value for {{level}}",
  删除该档映射: "Remove this level",

  // Provider card
  内置: "Built-in",
  自定义: "Custom",
  已保存key: "Key saved {{masked}}",
  "未保存 key": "No key saved",
  测试连接: "Test connection",
  "删除 provider": "Remove provider",
  "模型清单.自定义":
    "The model list is customized ({{n}}), so it no longer follows the built-in catalog.",
  恢复默认: "Reset",
  "模型清单.继承":
    "The endpoint and {{n}} models come from the built-in catalog and update with the app.",

  // Defaults
  默认模型: "Default model",
  "默认模型.说明": "Model used for new sessions; each session can override it.",
  选择默认模型: "Select default model",
  默认思考档位: "Default reasoning level",
  "默认思考档位.说明":
    "Sessions without their own setting use this value; the model must support reasoning.",

  // Model row
  "模型 id": "Model id",
  显示名: "Display name",
  上下文窗口: "Context window",
  最大输出: "Max output",
  思考: "Reasoning",
  删除模型: "Remove model",
  输入类型: "Input types",
  文本: "Text",
  图片: "Image",

  // Provider fields / model list
  名称: "Name",
  添加模型: "Add model",

  // Model picker
  上下文: "{{n}} context",
  输出: "{{n}} output",
  切换模型: "Switch model",
  选择模型: "Select model",
  搜索模型: "Search models",
  没有匹配的模型: "No matching model",
  视觉: "Vision",

  // Composer
  输入消息占位: "Type a message. Enter to send, Shift+Enter for a new line.",
  停止生成: "Stop generating",
  发送: "Send",

  // Assistant modes
  模式: "Mode",
  编码模式: "Build",
  计划模式: "Plan",
  问答模式: "Ask",
  "编码模式.说明": "Read, write and run commands directly.",
  "计划模式.说明": "Produce a plan first; read-only research without code changes.",
  "问答模式.说明": "Read-only analysis and answers; no file writes or commands.",
  切换模式失败: "Failed to switch mode",

  // Interaction request (permission / question)
  交互请求: "Interaction request",
  需要授权: "Approval required",
  "授权.说明": 'The agent wants to call "{{tool}}", target:',
  授权范围: "Grant scope: {{scope}}",
  子智能体来源: 'Request from subagent "{{description}}":',
  允许一次: "Allow once",
  本会话恒允: "Allow for this session",
  拒绝: "Deny",

  // Question (question tool)
  需要你回答: "Your input is needed",
  "提问.说明": "The agent needs your input to continue. Pick an option, or type your own answer.",
  可多选: "Multiple choice",
  "其他.占位": "Or type your own answer",
  提交回答: "Submit answers",
  跳过回答: "Skip",

  // Plan decision
  计划已就绪: "Plan ready",
  "计划已就绪.说明":
    "Approve to switch to Build mode and start, or add feedback below to keep discussing.",
  批准并执行: "Approve and run",
  提交反馈: "Send feedback",
  反馈占位: "Add feedback or objections to keep refining the plan",
  计划已批准: "The plan is approved. Please start executing.",

  // Starter suggestions
  了解这个项目: "Learn about this project",
  排查构建报错: "Debug build errors",
  补充单元测试: "Add unit tests",
  重构这段代码: "Refactor this code",

  // Messages
  思考过程: "Reasoning",
  上下文已压缩: "(context compacted)",
  扩展消息: "(extended message)",
  "思考中…": "Thinking…",
  执行中: "Running",
  失败: "Failed",
  完成: "Done",

  // Empty states
  "夜深了，接下来交给我吧": "It's late. Leave it to me.",
  "早上好，接下来交给我吧": "Good morning. Leave it to me.",
  "下午好，接下来交给我吧": "Good afternoon. Leave it to me.",
  "晚上好，接下来交给我吧": "Good evening. Leave it to me.",
  还没有配置模型: "No model configured yet",
  "未配置.说明":
    "Add an OpenAI-compatible endpoint (baseUrl / apiKey / model id) to start chatting.",
  打开设置: "Open settings",
  开始第一个会话: "Start your first session",
  "就绪.说明": "Model ready: {{model}}. Each session has its own workspace under ",
  "就绪.说明.后缀": ", where the agent reads, writes and runs commands.",

  // Rename dialog
  重命名会话: "Rename session",

  // Archive
  归档: "Archive",
  归档确认:
    'Archive session "{{name}}"? It disappears from the list; the conversation and files are kept.',
  已归档: "Archived",
  归档失败: "Archive failed",

  // Sidebar sections
  项目区: "Projects",
  助理区: "Assistant",
  在目录中新建: "New in directory",
  选择目录: "Choose directory",
  返回上级: "Go up",
  新建文件夹: "New folder",
  选择此目录: "Choose this directory",
  文件夹名: "Folder name",
  此处没有子目录: "No subdirectories here",
  没有匹配的目录: "No matching directory",
  输入绝对路径: "Enter an absolute path",
  创建文件夹失败: "Failed to create folder",

  // Session directory
  目录: "Directory",
  "目录.说明": "This session's working directory: the agent reads, writes and runs commands here.",
  暂无文件: "No files",

  // Requests and toasts
  "(未命名)": "(unnamed)",
  "校验.缺baseUrl": "{{label}} is missing baseUrl",
  "校验.缺模型": "{{label}} needs at least one model",
  "校验.缺模型id": "{{label}} has a model without an id",
  失败提示: "{{label}}: {{reason}}",
  模型列表加载失败: "Failed to load models",
  重建运行时失败: "Failed to rebuild the runtime",
  配置已保存: "Configuration saved",
  保存失败: "Failed to save",
  先填写供应商信息: "Fill in baseUrl and at least one model id first",
  连接成功: "Connected · {{latency}}ms · {{model}}",
  连接失败: "Connection failed",
  配置加载失败: "Failed to load configuration",
  新建会话失败: "Failed to create session",
  重命名失败: "Rename failed",
  切换模型失败: "Failed to switch model",
  设置thinking失败: "Failed to set thinking level",
  会话列表加载失败: "Failed to load sessions",

  // MCP
  "MCP.说明":
    "Connect MCP (Model Context Protocol) servers to give the agent extra tools; changes are written to the local config file and apply to new sessions.",
  "MCP.空态": "No MCP server configured yet.",
  添加服务器: "Add server",
  编辑: "Edit",
  已停用: "Disabled",
  "MCP.配置有误": "The config file has entries that could not be parsed:",
  "MCP.路径": "Config file: {{path}}",
  "添加 MCP 服务器": "Add MCP server",
  "编辑 MCP 服务器": "Edit MCP server",
  "MCP.表单说明":
    "stdio runs a local command, http talks to a remote URL; env vars and headers are one KEY=VALUE per line.",
  服务器名: "Server name",
  "服务器名.说明": "Used in mcp__<server>__<tool>; letters, digits, and . _ - only.",
  传输方式: "Transport",
  本地进程: "Local process",
  "HTTP 端点": "HTTP endpoint",
  暴露方式: "Exposure",
  "暴露方式.说明":
    "Scripts reach tools through codemode without declaring them to the model; in-script search keeps them out of the codemode description and finds them on demand; search-then-call declares them once tool_search loads them; Direct declares them right away.",
  脚本调用: "Scripts",
  脚本内检索: "In-script search",
  检索后调用: "Search then call",
  直接调用: "Direct",
  隐藏: "Hidden",
  启动命令: "Command",
  "启动命令.说明": "Executable that starts the MCP server, such as npx or uvx.",
  参数: "Arguments",
  "参数.说明": "Arguments passed to the command, one per line.",
  环境变量: "Environment",
  "环境变量.说明": "Environment variables for the child process; values may use ${NAME}.",
  工作目录: "Working directory",
  "工作目录.说明":
    "Server working directory; relative paths resolve against the session cwd. Empty uses the session cwd.",
  端点地址: "Endpoint URL",
  "端点地址.说明": "HTTP endpoint of the MCP server.",
  请求头: "Headers",
  "请求头.说明": "HTTP headers sent with requests; values may use ${NAME}.",
  超时: "Timeout",
  "超时.说明": "Per-request timeout in seconds; empty uses the default (60s).",
  状态: "Status",
  启用: "Enabled",
  停用: "Disabled",
  "MCP 服务器加载失败": "Failed to load MCP servers",
  "MCP 服务器保存失败": "Failed to save the MCP server",
  "MCP 服务器删除失败": "Failed to delete the MCP server",
};
