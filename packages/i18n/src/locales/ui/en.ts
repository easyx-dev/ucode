/**
 * Product UI catalog (English): interface vocabulary shared by web / Electron / TUI.
 *
 * This is the canonical, complete catalog: every key lives here, as the Simplified-Chinese copy
 * itself (with `{{placeholders}}`). Only pure placeholder templates use a `.`-namespaced summary
 * key that `zh-CN.ts` maps back to Chinese (see `zh-CN.ts`).
 * A few browser/desktop-only keys (theme, Shift+Enter, starter suggestions) go unused by a
 * TUI — ignore them. Surface-specific extras go through `createI18n`'s `appCatalogs`.
 * `scripts/verify` fails on drift.
 */
export default {
  // Common
  会话: "Sessions",
  "加载中…": "Loading…",
  暂无会话: "No sessions",
  暂无项目: "No projects",
  新建: "New",
  新建会话: "New session",
  新会话: "New session",
  会话列表: "Session list",
  设置: "Settings",
  取消: "Cancel",
  确定: "OK",
  知道了: "Got it",
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
  "按当前配置重建运行时，正在生成的会话本轮结束后切换":
    "Rebuild the runtime from the current config; busy sessions switch after their current turn",

  // Settings panel
  "外观、模型与联网搜索配置。保存后新配置从下一轮开始生效；apiKey 留空表示沿用已保存的 key。":
    "Appearance, model and web search configuration. The new config takes effect from the next turn; leave apiKey blank to keep the saved key.",
  返回工作区: "Back to workspace",
  基础设置: "Basics",
  "Agent 能力": "Agent capabilities",
  服务: "Service",
  外观: "Appearance",
  模型设置: "Models",
  默认值: "Defaults",
  "MCP 服务器": "MCP servers",
  保存并生效: "Save and apply",
  添加供应商: "Add provider",
  "还没有接入供应商，点右上角「添加供应商」。":
    "No provider yet. Use “Add provider” at the top right.",
  添加自定义供应商: "Add custom provider",
  "保存后新配置从下一轮开始生效；apiKey 留空表示沿用已保存的 key。":
    "The new config takes effect from the next turn; leave apiKey blank to keep the saved key.",
  "内置目录里的供应商只需再填一把 key；pi 不认识的端点用自定义供应商。":
    "Providers from the built-in catalog only need an API key; use a custom provider for endpoints pi does not know.",
  待配置: "Needs setup",
  已就绪: "Ready",

  // Web search
  联网搜索: "Web search",
  搜索服务商: "Search provider",
  "websearch 工具调用哪家搜索接口。": "Which search API the websearch tool calls.",
  "留空表示沿用已保存的 key；未配置时 websearch 会返回可读错误。":
    "Leave blank to keep the saved key; without a key the websearch tool returns a readable error.",
  实例地址: "Instance URL",
  "自建 SearXNG 的地址，需在 settings.yml 里开启 JSON 输出（search.formats 加 json）。":
    "URL of your SearXNG instance; enable JSON output in settings.yml (add json to search.formats).",

  // Memory
  记忆: "Memory",
  项目记忆: "Project memory",
  "开启后，每轮对话结束会在后台回顾并保存项目级长期记忆，同一项目的后续会话自动带上；记忆只保存在本机，并按项目目录隔离。":
    "When on, each conversation is reviewed in the background and durable facts are saved per project; later sessions in the same project load them automatically. Memory is stored locally and isolated by project directory.",
  开启: "On",

  // Appearance
  界面主题: "Theme",
  "深色模式下的配色与浅色模式一一对应，切换后立即生效并记住选择。":
    "Dark mode mirrors the light palette one-to-one. Changes apply immediately and are remembered.",
  浅色: "Light",
  深色: "Dark",
  跟随系统: "System",
  语言: "Language",
  "界面语言，切换后立即生效并记住选择。":
    "Interface language. Changes take effect immediately and are remembered.",
  显示: "Show",
  不显示: "Hide",
  "在消息区展示模型的思考过程；隐藏后只保留回答与工具调用。":
    "Show the model's reasoning in the message area; hiding keeps only answers and tool calls.",

  // Provider add dialog
  "搜索供应商，如 deepseek": "Search providers, e.g. deepseek",
  "没有匹配的供应商。": "No matching provider.",
  已加入: "Added",

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
  "未指定时按厂商默认处理，7 个档位都能用。":
    "Unspecified levels use the vendor default; all 7 levels are usable.",
  推理等级: "Reasoning level",
  思考档位: "Reasoning level",
  "厂商取值；留空 = 该档不支持": "Vendor value; blank = unsupported",
  "{{level}}档的厂商取值": "Vendor value for {{level}}",
  删除该档映射: "Remove this level",

  // Provider card
  内置: "Built-in",
  自定义: "Custom",
  "已保存 key {{masked}}": "Key saved {{masked}}",
  "未保存 key": "No key saved",
  测试连接: "Test connection",
  "删除 provider": "Remove provider",
  "模型清单已被自定义（{{n}} 个），不再随内置目录更新。":
    "The model list is customized ({{n}}), so it no longer follows the built-in catalog.",
  恢复默认: "Reset",
  "端点与 {{n}} 个模型来自内置目录，随应用升级自动更新。":
    "The endpoint and {{n}} models come from the built-in catalog and update with the app.",

  // Defaults
  默认模型: "Default model",
  "新建会话时使用的模型；会话内可以单独覆盖。":
    "Model used for new sessions; each session can override it.",
  选择默认模型: "Select default model",
  默认思考档位: "Default reasoning level",
  "未单独设置档位的会话使用该值；模型本身需支持思考。":
    "Sessions without their own setting use this value; the model must support reasoning.",

  // Model row
  "模型 id": "Model id",
  显示名: "Display name",
  "{{label}} 的{{field}}要填正整数": "{{field}} of {{label}} must be a positive integer",
  上下文窗口: "Context window",
  上下文预算: "Context budget",
  "有效上下文预算：到达即自动压缩；留空按窗口推算":
    "Effective context budget: compaction triggers when reached; leave empty to derive it from the window",
  留空自动: "Leave empty for auto",
  最大输出: "Max output",
  思考: "Reasoning",
  删除模型: "Remove model",
  输入类型: "Input types",
  文本: "Text",
  图片: "Image",

  // Provider fields / model list
  名称: "Name",
  添加模型: "Add model",

  // Fetch model list
  拉取模型列表: "Fetch model list",
  "按当前端点的 /models 拉取，点条目即填入下方模型。":
    "Fetch from the endpoint's /models; click an entry to fill in a model below.",
  "已拉取 {{n}} 个模型 · {{latency}}ms": "Fetched {{n}} models · {{latency}}ms",
  收起: "Collapse",
  "上游返回的条数超过上限，只显示前 {{n}} 条。":
    "The upstream returned more than the limit; only the first {{n}} are shown.",
  "上游没有返回任何模型，请确认端点是否兼容 /models。":
    "The upstream returned no models; check that the endpoint serves /models.",
  已在配置里: "Already configured",
  "来源：{{source}}": "Source: {{source}}",
  已配置: "Configured",
  上游: "Upstream",
  内置目录: "Built-in catalog",
  "按 id 推断": "Inferred from id",
  按默认值: "From defaults",
  "先填写 baseUrl 再拉取模型列表": "Fill in baseUrl before fetching the model list",
  "该供应商还没有 apiKey，先填写或保存一个再拉取":
    "This provider has no apiKey yet; fill one in or save it before fetching",
  填入这条模型: "Use this model",

  // Model picker
  "{{n}} 上下文": "{{n}} context",
  "{{n}} 输出": "{{n}} output",
  切换模型: "Switch model",
  选择模型: "Select model",
  搜索模型: "Search models",
  没有匹配的模型: "No matching model",
  视觉: "Vision",

  // Composer
  "输入消息，Enter 发送，Shift+Enter 换行":
    "Type a message. Enter to send, Shift+Enter for a new line.",
  停止生成: "Stop generating",
  发送: "Send",
  图片预览: "Image preview",
  图片不可用: "Image unavailable",
  附件不可用: "Attachment unavailable",
  "无法添加附件：{{names}}": "Could not add attachments: {{names}}",
  "改写这条消息，Enter 发送，Shift+Enter 换行":
    "Edit this message. Enter to send, Shift+Enter for a new line.",

  // 内置命令说明（`/` 菜单提示与 /help 清单）
  重命名当前会话: "Rename the current session",
  归档当前会话: "Archive the current session",
  从当前会话分叉: "Fork from the current session",
  切换当前会话的模型: "Switch the current session's model",
  切换思考档位: "Switch the thinking level",
  切换助手模式: "Switch the assistant mode",
  切换权限档位: "Switch the permission level",
  请先接入模型供应商: "Connect a model provider first",

  // Assistant modes
  模式: "Mode",
  编码: "Build",
  计划: "Plan",
  问答: "Ask",
  "可直接读写文件、执行命令。": "Read, write and run commands directly.",
  "先给出方案，只读调研不改代码。":
    "Produce a plan first; read-only research without code changes.",
  "只读分析与回答，不改文件、不执行命令。":
    "Read-only analysis and answers; no file writes or commands.",
  切换模式失败: "Failed to switch mode",

  // Permission levels
  权限档位: "Permission level",
  默认: "Default",
  自动批准: "Auto-approve",
  完全访问: "Full access",
  "按模式规则执行，需要授权时弹窗确认。":
    "Follow the mode rules; prompt for approval when required.",
  "自动批准常规工具，访问工作目录之外仍会询问。":
    "Auto-approve routine tools; still ask before touching paths outside the working directory.",
  "自动批准所有操作（含工作目录之外），仅保留规则里的阻断。":
    "Auto-approve everything, including paths outside the working directory; only rule-based blocks remain.",

  // Interaction request (permission / question)
  交互请求: "Interaction request",
  "agent 想调用「{{tool}}」，操作对象：": 'The agent wants to call "{{tool}}", target:',
  "授权范围：{{scope}}": "Grant scope: {{scope}}",
  "来自子智能体「{{description}}」的请求：": 'Request from subagent "{{description}}":',
  允许一次: "Allow once",
  本会话恒允: "Allow for this session",
  拒绝: "Deny",

  // Question (question tool)
  展开: "Expand",

  // Plan decision
  计划已就绪: "Plan ready",
  "批准后切换到编码模式开始执行；也可以在下方补充意见，继续讨论计划。":
    "Approve to switch to Build mode and start, or add feedback below to keep discussing.",
  批准并执行: "Approve and run",
  提交反馈: "Send feedback",
  忽略: "Ignore",
  已忽略计划: "Plan ignored",
  本次计划不再弹出决策表单: "Stop showing the decision form for this plan",
  "对计划有补充或异议？写在这里继续讨论": "Add feedback or objections to keep refining the plan",
  "计划已批准，请开始执行。": "The plan is approved. Please start executing.",

  // Starter suggestions
  了解这个项目: "Learn about this project",
  排查构建报错: "Debug build errors",
  补充单元测试: "Add unit tests",
  重构这段代码: "Refactor this code",

  // Messages
  思考过程: "Reasoning",
  子智能体过程: "Subagent progress",
  "（扩展消息）": "(extended message)",
  对话已压缩: "Conversation compacted",
  目标完成: "Goal completed",
  需要权限: "Permission required",
  提示音: "Notification sound",
  试听: "Preview",
  "等待输入、本轮完成或出错时播放提示音；与系统通知各自独立，页面在前台也会响。":
    "Play a sound when input is needed, a turn finishes, or an error occurs; independent of system notifications and audible while the page is in the foreground.",
  输入自己的答案: "Type your own answer",
  "{{current}}/{{total}} 个问题": "{{current}}/{{total}} questions",
  选择一个答案: "Pick one answer",
  选择多个答案: "Pick one or more answers",
  "输入你的答案…": "Type your answer…",
  下一步: "Next",
  返回: "Back",
  回到上一个问题: "Go back to the previous question",
  提交全部作答: "Submit every answer",
  看下一个问题: "Show the next question",
  "跳到第 {{index}} 题": "Jump to question {{index}}",
  "放弃这组问题，本轮按没有答复继续": "Discard these questions and continue without answers",
  提交: "Submit",
  模式已切换: "Mode changed",
  权限档位已切换: "Permission level changed",
  模式与权限档位已切换: "Mode and permission level changed",
  "{{turns}} 轮 · {{tokens}}": "{{turns}} turns · {{tokens}}",
  目标启动: "Goal started",
  "目标续跑 · 第 {{turn}} 轮": "Goal continued · round {{turn}}",
  目标恢复: "Goal resumed",
  计划已批准: "Plan approved",
  手动: "Manual",
  达阈值: "Token threshold",
  超窗口: "Context overflow",
  未知原因: "unknown reason",
  "正在压缩上下文…": "Compacting context",
  "当前上下文已经很紧凑，无需压缩": "The context is already compact enough; nothing to compact.",
  "当前上下文已经是压缩后的状态，无需重复压缩":
    "The context is already compacted; there is nothing to compact again.",
  "自动压缩失败：{{reason}}": "Automatic compaction failed: {{reason}}",
  "会话正在生成，等这一轮结束再压缩":
    "The session is generating; compact after this turn finishes.",
  工作中: "Working",
  执行中: "Running",
  失败: "Failed",
  完成: "Done",
  "耗时 {{value}}": "Took {{value}}",
  回到底部: "Jump to latest",

  // Tool calls
  读取: "Read",
  写入: "Write",
  Shell: "Shell",
  查找: "Find",
  列出: "List",
  获取网页: "Fetch",
  子智能体: "Subagent",
  提问: "Ask",
  搜索工具: "Search tools",
  工具: "Tool",
  已提问: "Asked",
  提问中: "Asking",
  未回答: "Not answered",
  "（未回答）": "(not answered)",
  "来自子智能体「{{description}}」": "From subagent “{{description}}”",
  已允许一次: "Allowed once",
  本会话已允许: "Allowed for this session",
  已拒绝: "Denied",
  "{{scope}} 在本会话内不再询问": "{{scope}} — no longer asked in this session",
  "使用了 {{used}}": "Used {{used}}",
  "思考了 {{value}} 次": "Thought {{value}} times",
  "思考了 {{think}} 次，使用了 {{used}}": "Thought {{think}} times, used {{used}}",
  "{{value}} 个 {{name}}": "{{value}} {{name}}",
  "，": ", ",
  等: ", etc.",
  读: "Read",
  写: "Write",
  执行: "Run",
  网络: "Web",
  其他: "Other",
  "（无输出）": "(no output)",
  "（无内容）": "(no content)",
  "显示全部 {{value}} 行": "Show all {{value}} lines",

  // Sub-session navigation
  子会话: "Sub-session",
  返回父会话: "Back to parent",
  打开子会话: "Open sub-session",
  查看子会话: "View sub-session",
  还没有内容: "No content yet",
  "子会话是委派产生的独立对话，只能查看；需要它继续请在父会话里说明。":
    "Sub-sessions are independent delegated conversations and are read-only. To continue, ask in the parent session.",

  // Session fork
  从此分叉: "Fork from here",
  "分叉自「{{name}}」": 'Forked from "{{name}}"',
  分叉失败: "Failed to fork",
  打开源会话: "Open source session",

  // Edit history
  编辑并重新发送: "Edit and resend",
  "发送后将移除这条消息之后的内容（仍保留在会话记录中）。":
    "Sending will remove everything after this message (kept in the session record).",

  // Empty states
  "夜深了，接下来交给我吧": "It's late. Leave it to me.",
  "早上好，接下来交给我吧": "Good morning. Leave it to me.",
  "下午好，接下来交给我吧": "Good afternoon. Leave it to me.",
  "晚上好，接下来交给我吧": "Good evening. Leave it to me.",
  还没有配置模型: "No model configured yet",
  "填入一个 OpenAI 兼容端点（baseUrl / apiKey / 模型 id）后即可开始对话。":
    "Add an OpenAI-compatible endpoint (baseUrl / apiKey / model id) to start chatting.",
  打开设置: "Open settings",
  开始第一个会话: "Start your first session",
  "模型已就绪：{{model}}。每个会话有独立的工作区":
    "Model ready: {{model}}. Each session has its own workspace under ",
  "，agent 在其中读写文件并执行命令。": ", where the agent reads, writes and runs commands.",

  // Rename dialog
  重命名会话: "Rename session",

  // Archive
  归档: "Archive",
  "归档会话「{{name}}」？": 'Archive session "{{name}}"?',
  "会话会从列表里隐藏，对话与文件都保留。":
    "It is hidden from the list; the conversation and files are kept.",
  "它的子会话会一并归档，对话与文件都保留。":
    "Its sub-sessions are archived too; the conversations and files are kept.",
  已归档: "Archived",
  归档失败: "Archive failed",

  // Sidebar sections
  项目: "Projects",
  助理: "Assistant",
  助理区: "Assistant",
  选择目录: "Choose directory",
  返回上级: "Go up",
  新建文件夹: "New folder",
  选择此目录: "Choose this directory",
  文件夹名: "Folder name",
  此处没有子目录: "No subdirectories here",
  没有匹配的目录: "No matching directory",
  输入绝对路径: "Enter an absolute path",
  创建文件夹失败: "Failed to create folder",

  // Sidebar menu and session rows
  新建任务: "New task",
  小助理: "Assistant",
  搜索: "Search",
  自动化: "Automation",
  插件市场: "Marketplace",
  打开工作区: "Open workspace",
  切换侧边栏: "Toggle sidebar",
  置顶: "Pin",
  取消置顶: "Unpin",
  未读: "Unread",
  自动化功能即将推出: "Automation is coming soon",
  插件市场即将推出: "Marketplace is coming soon",
  本地用户: "Local user",

  // Command palette
  全部: "All",
  操作: "Actions",
  任务: "Tasks",
  "搜索操作、任务或文件": "Search actions, tasks or files",
  无匹配结果: "No results",
  "搜索中…": "Searching…",

  // Session directory
  目录: "Directory",
  "这个会话的工作目录：agent 读写文件、执行命令都在这里。":
    "This session's working directory: the agent reads, writes and runs commands here.",
  暂无文件: "No files",

  // Requests and toasts
  "(未命名)": "(unnamed)",
  "{{label}} 缺少 baseUrl": "{{label}} is missing baseUrl",
  "{{label}} 至少要有一个模型": "{{label}} needs at least one model",
  "{{label}} 里有模型没填 id": "{{label}} has a model without an id",
  "失败提示.模板": "{{label}}: {{reason}}",
  模型列表加载失败: "Failed to load models",
  重建运行时失败: "Failed to rebuild the runtime",
  配置已保存: "Configuration saved",
  保存失败: "Failed to save",
  "先填写 baseUrl 和至少一个模型 id": "Fill in baseUrl and at least one model id first",
  "连接成功 · {{latency}}ms · {{model}}": "Connected · {{latency}}ms · {{model}}",
  连接失败: "Connection failed",
  "连接服务失败，请确认服务已启动。": "Failed to reach the service. Check that it is running.",
  重试: "Retry",
  配置加载失败: "Failed to load configuration",
  新建会话失败: "Failed to create session",
  重命名失败: "Rename failed",
  切换模型失败: "Failed to switch model",
  "设置 thinking level 失败": "Failed to set thinking level",
  会话列表加载失败: "Failed to load sessions",

  // MCP
  "接入 MCP（Model Context Protocol）服务器，为 agent 增加外部工具；改动写入本机配置文件，新会话生效。":
    "Connect MCP (Model Context Protocol) servers to give the agent extra tools; changes are written to the local config file and apply to new sessions.",
  "还没有配置 MCP 服务器。": "No MCP server configured yet.",
  添加服务器: "Add server",
  编辑: "Edit",
  已停用: "Disabled",
  "配置文件有无法解析的条目：": "The config file has entries that could not be parsed:",
  "配置文件：{{path}}": "Config file: {{path}}",
  "添加 MCP 服务器": "Add MCP server",
  "编辑 MCP 服务器": "Edit MCP server",
  "stdio 走本地命令，http 走远端地址；环境变量与请求头一行一条 KEY=VALUE。":
    "stdio runs a local command, http talks to a remote URL; env vars and headers are one KEY=VALUE per line.",
  服务器名: "Server name",
  "用于拼出 mcp__<服务器名>__<工具名>；名字里的非字母、数字、下划线字符在工具名中会转为 _。只允许字母、数字与 . _ -。":
    "Used in mcp__<server>__<tool>; characters other than letters, digits, and underscores become _ in the tool name. Letters, digits, and . _ - only.",
  传输方式: "Transport",
  本地进程: "Local process",
  "HTTP 端点": "HTTP endpoint",
  暴露方式: "Exposure",
  "脚本调用经 codemode 使用、不声明给模型、由脚本按需查找；检索后调用经 tool_search 加载后再声明给模型；直接调用会立即声明给模型。":
    "Scripts reach tools through codemode without declaring them to the model, finding them on demand; Search then call declares them once tool_search loads them; Direct declares them right away.",
  脚本调用: "Scripts",
  检索后调用: "Search then call",
  直接调用: "Direct",
  隐藏: "Hidden",
  启动命令: "Command",
  "启动 MCP 服务器的可执行文件，如 npx / uvx。":
    "Executable that starts the MCP server, such as npx or uvx.",
  参数: "Arguments",
  "传给启动命令的参数，一行一个。": "Arguments passed to the command, one per line.",
  环境变量: "Environment",
  "传给子进程的环境变量，值可写 ${NAME} 引用环境变量。":
    "Environment variables for the child process; values may use ${NAME}.",
  工作目录: "Working directory",
  "服务器的工作目录，相对路径按会话工作目录解析；留空即用会话工作目录。":
    "Server working directory; relative paths resolve against the session cwd. Empty uses the session cwd.",
  端点地址: "Endpoint URL",
  "MCP 服务器的 HTTP 端点。": "HTTP endpoint of the MCP server.",
  请求头: "Headers",
  "请求时携带的 HTTP 头，值可写 ${NAME} 引用环境变量。":
    "HTTP headers sent with requests; values may use ${NAME}.",
  超时: "Timeout",
  "单次请求的超时秒数；留空即用默认值（60 秒）。":
    "Per-request timeout in seconds; empty uses the default (60s).",
  状态: "Status",
  启用: "Enabled",
  停用: "Disabled",
  "MCP 服务器加载失败": "Failed to load MCP servers",
  "MCP 服务器保存失败": "Failed to save the MCP server",
  "MCP 服务器删除失败": "Failed to delete the MCP server",

  // Usage statistics
  使用统计: "Usage",
  当前会话上下文占用: "Current session context usage",
  "{{used}} / {{window}} token": "{{used}} / {{window}} tokens",
  "估算 · {{used}} / {{window}} token": "Estimated · {{used}} / {{window}} tokens",
  "压缩后为估算值，新一轮回答后回到实测":
    "Estimated after compaction; the next response restores the measured value.",
  "从本机会话记录汇总的 token 用量；不含模型成本，子会话与分叉会话一并计入。":
    "Token usage aggregated from local session records; model cost is not included, and subagent / forked sessions are counted.",
  按会话: "By session",
  "工具调用 {{value}} 次": "{{value}} tool calls",
  "最近 30 天": "Last 30 days",
  "最近 7 天": "Last 7 days",
  主会话: "Primary",
  分叉: "Forked",
  "累计 token": "Total tokens",
  "峰值 token": "Peak tokens",
  最长聊天时长: "Longest chat",
  当前连续天数: "Current streak",
  最长连续天数: "Longest streak",
  "{{value}} 天": "{{value}} days",
  "活跃 {{value}} 天": "{{value}} active days",
  "不到 1 分钟": "Under a minute",
  "{{minutes}} 分钟": "{{minutes}} min",
  "{{hours}} 小时 {{minutes}} 分": "{{hours}} h {{minutes}} min",
  "{{days}} 天 {{hours}} 小时": "{{days}} d {{hours}} h",
  "{{month}} 月": "{{month}}",
  "{{month}} 月 {{day}} 日": "{{month}}/{{day}}",
  "{{date}} · {{tokens}} token · {{messages}} 轮消息":
    "{{date}} · {{tokens}} tokens · {{messages}} responses",
  "Token 活动": "Token activity",
  每日: "Daily",
  每周: "Weekly",
  累计: "Cumulative",
  周一: "Mon",
  周三: "Wed",
  周五: "Fri",
  少: "Less",
  多: "More",
  "每日 Token 趋势": "Daily token trend",
  "峰值 {{value}} token": "Peak {{value}} tokens",
  模型用量: "Model usage",
  当前区间暂无可用量数据: "No usage in this range",
  还没有可展示的数据: "Nothing to show yet",

  // Goal mode
  目标: "Goal",
  进行中: "Active",
  已完成: "Completed",
  暂停: "Pause",
  恢复: "Resume",
  清除: "Clear",
  "第 {{n}} 轮": "Turn {{n}}",
  "{{used}} token": "{{used}} tokens",
  "{{used}} / {{budget}} token": "{{used}} / {{budget}} tokens",
  还没有设置目标: "No goal set yet",
  已暂停: "Paused",
  因切换模式暂停: "Paused: mode switched",
  已中断: "Interrupted",
  无进展已暂停: "Paused: no progress",
  达到轮数上限: "Paused: turn limit",
  达到用量上限: "Paused: token budget",
  生成出错已暂停: "Paused: error",
  设置目标失败: "Failed to set the goal",
  暂停目标失败: "Failed to pause the goal",
  恢复目标失败: "Failed to resume the goal",
  清除目标失败: "Failed to clear the goal",
  目标加载失败: "Failed to load the goal",

  // Composer commands
  内置动作: "Built-in",
  命令: "Commands",
  技能: "Skills",
  文件: "Files",
  帮助: "Help",
  压缩上下文: "Compact context",
  开始一个新会话: "Start a new session",
  中断当前生成: "Interrupt the current run",
  压缩当前会话的上下文: "Compact this session's context",
  查看或设定会话目标: "View or set the session goal",
  查看全部命令: "Show all commands",
  "在输入框以 /goal 开头设定或查看目标": "Start the input with /goal to set or view the goal",
  "可用内置命令见输入框的 / 菜单": "See the / menu in the composer for built-in commands",

  // Auth / login
  登录: "Sign in",
  密码: "Password",
  输入服务密码: "Enter the service password",
  "密码在服务首次启动时生成，可查看服务注册文件 service.json。":
    "The password is generated on first start; find it in the service registration file service.json.",

  // Remote access
  远程访问: "Remote access",
  局域网访问: "LAN access",
  仅本机: "This device only",
  局域网: "LAN",
  "让同一网络下的设备接入本服务。通过鉴权的设备等于本机 owner，可驱动 agent 读写文件、执行命令。":
    "Let devices on the same network reach this service. An authenticated device is the local owner and can drive the agent to read/write files and run commands.",
  "已允许局域网设备访问；如需关闭请切回「仅本机」并重启服务。":
    "LAN devices can reach this service. To turn it off, switch back to “This device only” and restart the service.",
  "当前仅本机可访问；开启后同一网络下的设备可访问，请只在可信网络使用。":
    "Only this device can reach the service. Turning this on exposes it to the same network; use it on trusted networks only.",
  "监听地址已更新，需要重启服务后生效。":
    "The listen address changed. Restart the service for it to take effect.",
  配对链接: "Pairing link",
  "生成一条链接发给同一网络下的设备，打开即可接入；5 分钟内有效，且只能使用一次。":
    "Generate a link for a device on the same network; opening it signs the device in. Valid for 5 minutes and usable once.",
  生成配对链接: "Generate pairing link",
  复制链接: "Copy link",
  复制: "Copy",
  已复制: "Copied",
  "剩余有效时间 {{time}}": "Expires in {{time}}",
  链接已过期: "Link expired",
  活动会话: "Active sessions",
  暂无活动会话: "No active sessions",
  本端: "This device",
  "最近使用 {{time}}": "Last used {{time}}",
  撤销: "Revoke",
  修改密码: "Change password",
  当前密码: "Current password",
  新密码: "New password",
  "新密码至少 8 位；修改后所有设备都需要重新登录。":
    "At least 8 characters; all devices will need to sign in again after the change.",

  // Notifications（系统通知的标题与设置项）
  消息通知: "Notifications",
  "会话等待你的输入、完成或出错时发送系统通知；页面在前台时不打扰。":
    "Send a system notification when a session waits for input, finishes or fails; stays quiet while this page is in the foreground.",
  等待权限审批: "Waiting for permission",
  等待你的回答: "Waiting for your answer",
  等待计划确认: "Waiting for plan review",
  会话已完成: "Session finished",
  会话出错: "Session failed",
  允许通知: "Allow notifications",
  "浏览器还没有允许通知，点「允许通知」授权后才会送达。":
    "The browser hasn't granted notification permission yet — use “Allow notifications” to grant it.",
  "浏览器已拒绝通知，需要在浏览器的网站设置里允许后才能送达。":
    "Notifications are blocked; allow them in the browser's site settings.",
  "当前环境不支持系统通知。": "This environment doesn't support system notifications.",

  // Desktop shell（桌面端启动时的连接态）
  未连接到本机服务: "Not connected to the local service",
  "未找到服务注册文件 {{path}}，请先启动服务。":
    "Service registration file not found: {{path}}. Start the service first.",
  "无法连接本机服务，请确认服务已启动。":
    "Cannot reach the local service. Make sure it is running.",
  "服务凭证无效，请重启服务后重试。":
    "The service credential is invalid. Restart the service and try again.",

  // Workbench（右侧第三栏：改动 / 文件预览）
  工作台: "Workbench",
  收起工作台: "Collapse workbench",
  打开工作台: "Open workbench",
  切换工作台: "Toggle workbench",
  改动: "Changes",
  "改动 / 文件": "Changes / files",
  历史: "History",
  查看内容: "Show",
  刷新: "Refresh",
  刷新目录: "Refresh folder",
  调整侧栏宽度: "Resize sidebar",

  收起面板: "Collapse panel",
  当前没有工作目录: "No working directory",
  "当前目录不在 git 仓库内，没有可查看的改动":
    "This folder is not inside a git repository, so there are no changes to show",
  "（无分支）": "(no branch)",
  有冲突: "Conflicted",
  已暂存: "Staged",
  未暂存: "Unstaged",
  未跟踪: "Untracked",
  工作区没有改动: "No changes in the working tree",
  "变更过多，仅列出前一部分": "Too many changes; only the first part is listed",
  在预览器里打开: "Open in preview",
  还没有提交: "No commits yet",
  "（无标题）": "(no subject)",
  加载更多: "Load more",
  返回变更列表: "Back to changes",
  返回提交详情: "Back to commit",
  "仅显示前 {{value}} 条": "Only the first {{value}} entries are shown",
  返回提交列表: "Back to commits",
  这个提交没有改动文件: "This commit changed no files",
  "二进制文件，git 不展开差异": "Binary file; git does not expand its diff",
  没有差异: "No differences",
  "差异过大，已按上限截断": "The diff is too large and was truncated",
  打开文件: "Open file",
  在左侧项目树里选一个文件: "Pick a file from the project tree",
  选择左侧的条目: "Select an item on the left",
  "改动看前后对比，历史看每次提交": "Changes show the before/after diff; history shows each commit",
  工作台标签: "Workbench tabs",
  显示树面板: "Show tree panel",
  隐藏树面板: "Hide tree panel",
  筛选文件: "Filter files",
  没有匹配的文件: "No matching files",
  预览: "Preview",
  源码: "Source",
  展示方式: "View mode",
  重新读取文件: "Reload file",
  "文件太大，未内联内容": "File is too large to inline",
  "二进制文件，无法预览": "Binary file; nothing to preview",
  "这类文件还看不了，后续会接入渲染器":
    "This file type can't be previewed yet; a renderer is planned",
  "内容过大，已按上限截断": "Content is too large and was truncated",
  "仅显示前 {{value}} 行": "Only the first {{value}} lines are shown",
  "仅列出前 {{value}} 项，共 {{total}} 项":
    "Only the first {{value}} of {{total}} entries are listed",
  "预览 {{path}}": "Preview {{path}}",
};
