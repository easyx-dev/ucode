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
  工作目录: "the working directory",
  中文: "中文",

  // Chat header
  未配置模型: "No model configured",
  去设置: "Open settings",
  重建运行时: "Rebuild runtime",
  "重建运行时.说明": "Discard in-memory sessions and rebuild the runtime from the current config",

  // Settings dialog
  "设置.说明":
    "Appearance, model and web search configuration. Saving rebuilds the pi runtime; leave apiKey blank to keep the saved key.",
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
  "推理等级.空态": "Unspecified levels use the vendor default; all 7 pi levels are usable.",
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
  "模型清单.自定义": "The model list is customized ({{n}}), so it no longer updates with pi.",
  恢复默认: "Reset",
  "模型清单.继承":
    "The endpoint and {{n}} models come from pi's built-in catalog and update with pi.",

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
  先新建一个会话: "Create a session first",
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

  // Permission approval
  需要授权: "Approval required",
  "授权.说明": 'The agent wants to call "{{tool}}", target:',
  授权范围: "Grant scope: {{scope}}",
  允许一次: "Allow once",
  本会话恒允: "Allow for this session",
  拒绝: "Deny",

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
  "就绪.说明": "Model ready: {{model}}. The session agent can read and write files under ",
  "就绪.说明.后缀": " and run commands.",

  // Rename dialog
  重命名会话: "Rename session",

  // Delete confirmation
  删除会话确认: 'Delete session "{{name}}"? This cannot be undone.',

  // Projects
  项目空间: "Project space",
  添加项目空间: "Add project space",
  默认: "Default",
  重命名项目: "Rename project",
  删除项目: "Remove project",
  删除项目确认:
    'Remove project "{{name}}"? Its sessions move back to "Default"; the sessions themselves are kept.',
  选择目录: "Choose directory",
  返回上级: "Go up",
  新建文件夹: "New folder",
  选择此目录: "Choose this directory",
  文件夹名: "Folder name",
  此处没有子目录: "No subdirectories here",
  没有匹配的目录: "No matching directory",
  输入绝对路径: "Enter an absolute path",
  项目列表加载失败: "Failed to load projects",
  项目已添加: "Project added",
  添加项目失败: "Failed to add project",
  项目已删除: "Project removed",
  重命名项目失败: "Rename failed",
  删除项目失败: "Remove failed",
  创建文件夹失败: "Failed to create folder",

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
  会话已删除: "Session deleted",
  删除失败: "Delete failed",
  会话列表加载失败: "Failed to load sessions",
};
