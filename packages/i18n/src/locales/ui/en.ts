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
  重命名项目: "Rename project",
  留空即用目录名: "Leave empty to use the directory name",
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
  "{{count}} 个": "{{count}}",
  服务器: "Servers",
  "还没有配置 MCP 服务器": "No MCP server configured yet",
  "添加服务器后，它提供的工具会出现在新会话里。":
    "Once a server is added, its tools show up in new sessions.",
  "管理插件的启停、配置与来源。":
    "Manage plugins: enable, configure and inspect where they come from.",
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

  // Appearance
  界面主题: "Theme",
  "深色模式下的配色与浅色模式一一对应，切换后立即生效并记住选择。":
    "Dark mode mirrors the light palette one-to-one. Changes apply immediately and are remembered.",
  浅色: "Light",
  深色: "Dark",
  跟随系统: "System",
  配色主题: "Color theme",
  "换一组颜色，字体、字号与圆角不受影响。":
    "Swap the color palette; fonts, text size, and radius stay as they are.",
  冷灰: "Zinc",
  界面字号: "Text size",
  "控制文字与图标的大小；间距与控件高度由界面密度决定。":
    "Controls the size of text and icons; spacing and control heights come from density.",
  界面密度: "Density",
  "控制间距、控件高度与栏宽；不影响文字大小。":
    "Controls spacing, control heights, and panel widths; text size is unaffected.",
  紧凑: "Compact",
  宽松: "Comfortable",
  界面字体: "Interface font",
  "界面文字使用的字体，选中后按需加载并立即生效。":
    "Font used for interface text. Loaded on demand and applied immediately.",
  系统默认: "System default",
  语言: "Language",
  "界面语言，切换后立即生效并记住选择。":
    "Interface language. Changes take effect immediately and are remembered.",
  显示思考过程: "Show thinking",
  "在消息区展示模型的思考过程；关闭后只保留回答与工具调用。":
    "Show the model's reasoning in the message area; turning it off keeps only answers and tool calls.",

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
  自动: "Auto",
  "自动 · {{level}}": "Auto · {{level}}",
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
  "API 格式": "API format",
  添加模型: "Add model",
  编辑模型: "Edit model",
  模型列表: "Models",
  未命名模型: "Untitled model",
  "还没有模型：拉取上游列表，或手动添加一个。":
    "No model yet: fetch the upstream list or add one by hand.",
  "字段随草稿一起保存；数字留空表示按默认值处理。":
    "Fields save with the draft; leave a number empty to use its default.",
  "该模型支持推理档位；关掉后不再向它传思考档。":
    "The model supports reasoning levels; turning this off stops sending them.",

  // Fetch model list
  拉取模型列表: "Fetch model list",
  "拉取中…": "Fetching…",
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
  没有可选的模型: "No models available",
  视觉: "Vision",

  // Composer
  "输入消息，Enter 发送，Shift+Enter 换行":
    "Type a message. Enter to send, Shift+Enter for a new line.",
  停止生成: "Stop generating",
  发送: "Send",
  "向 {{name}} 提问，使用 @ 添加上下文，使用 / 选择命令或能力":
    "Ask {{name}} anything. Use @ to add context, / to pick a command or skill",
  提出后续修改要求: "Describe the next change",
  当前分支: "Current branch",
  "不绑定项目，会话落在助理区": "No project; the session lives in the assistant area",
  搜索工作区: "Search workspaces",
  还没有打开过项目: "No project opened yet",
  添加: "Add",
  附件: "Attachment",
  当前目录没有技能: "No skills in this directory",
  正文开头已经有一条命令或技能: "The message already starts with a command or skill",
  "@ 添加上下文": "@ to add context",
  "/ 选择命令或技能": "/ to pick a command or skill",
  图片预览: "Image preview",
  "图片{{index}}": "Image {{index}}",
  图片不可用: "Image unavailable",
  附件不可用: "Attachment unavailable",
  图表: "Diagram",
  表格: "Table",
  "图表渲染中…": "Rendering diagram…",
  图表预览: "Diagram preview",
  全屏查看: "View fullscreen",
  "图表全屏预览：拖拽平移，Ctrl 加滚轮缩放":
    "Diagram fullscreen preview: drag to pan, Ctrl + scroll to zoom",
  缩小: "Zoom out",
  放大: "Zoom in",
  缩放比例: "Zoom level",
  适配窗口: "Fit to window",
  重置缩放: "Reset zoom",
  关闭预览: "Close preview",
  表格预览: "Table preview",
  "导出 CSV": "Export CSV",
  "复制为 Markdown": "Copy as Markdown",
  "表格全屏预览：表格自己横向滚动":
    "Table fullscreen preview: the table scrolls horizontally on its own",
  图片全屏预览: "Image fullscreen preview",
  "图片全屏预览：拖拽平移，Ctrl 加滚轮缩放":
    "Image fullscreen preview: drag to pan, Ctrl + scroll to zoom",
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
  "读写文件、执行命令。": "Read, write and run commands directly.",
  "先出方案，只读调研不改代码。": "Plan first; read-only research, no code changes.",
  "只读分析，不改文件不跑命令。": "Read-only analysis; no file writes or commands.",
  切换模式失败: "Failed to switch mode",

  // Permission levels
  权限档位: "Permission level",
  默认: "Default",
  自动批准: "Auto-approve",
  完全访问: "Full access",
  "需要授权时弹窗确认。": "Prompt for approval when required.",
  "常规工具放行，目录外仍询问。":
    "Routine tools allowed; still asks outside the working directory.",
  "全部放行，仅保留规则阻断。": "Everything allowed; only rule-based blocks remain.",

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
  查看进度: "View progress",
  "{{n}} 个子智能体": "{{n}} subagents",
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
  "{{turns}} 轮 · {{tokens}}": "{{turns}} turns · {{tokens}}",
  未达成: "Not achieved",
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
  PowerShell: "PowerShell",
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

  // Message outline
  用户消息目录: "User messages",
  "跳到第 {{index}} 条用户消息": "Jump to user message {{index}}",

  // Empty states
  "深夜好呀，有什么想让我帮忙的吗": "Still up? What can I help with?",
  "上午好呀，有什么想让我帮忙的吗": "Good morning. What can I help with?",
  "下午好呀，有什么想让我帮忙的吗": "Good afternoon. What can I help with?",
  "晚上好呀，有什么想让我帮忙的吗": "Good evening. What can I help with?",
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
  选择文件: "Choose file",
  配置: "Configure",
  启用插件: "Enable plugin",
  "开关由本仓库的覆盖文件决定，改文件才生效。":
    "The switch is set by this repository's override file; edit that file to change it.",
  "本仓库的覆盖文件：{{project}}（个人覆盖：{{local}}）":
    "Override files for this repository: {{project}} (personal: {{local}})",
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

  // Settings · assets（角色 / 技能 / 命令）
  主模式: "Primary",
  两者皆可: "Both",
  "自定义子智能体：改动写入本机或本项目的配置文件，新会话生效。":
    "Custom agents: changes go to the global or project config and apply to new sessions.",
  "技能是给模型的说明书：改动写入磁盘，新会话生效。":
    "Skills are instructions for the model: changes go to disk and apply to new sessions.",
  "提示词命令：改动写入磁盘，新会话生效。":
    "Prompt commands: changes go to disk and apply to new sessions.",
  本机与项目: "This machine and project",
  "{{count}} 项": "{{count}}",
  插件与内置: "From plugins and built-ins",
  "本机与项目里还没有自定义项。": "No custom entry here yet.",
  "有无法解析的文件：": "Files that could not be parsed:",
  当前项目: "Current project",
  "项目 .agents": "Project .agents",
  全局: "Global",
  "用户 .agents": "User .agents",
  "被同名项覆盖：{{path}}": "Overridden by a same-named entry: {{path}}",
  "删除 {{name}}？": "Delete {{name}}?",
  删除角色: "Delete agent",
  删除技能: "Delete skill",
  删除命令: "Delete command",
  "技能目录连同其中的引用文件、脚本一并删除，无法撤销。":
    "The skill directory, including its references and scripts, is deleted. This cannot be undone.",
  "文件从磁盘上删除，无法撤销。": "The file is deleted from disk. This cannot be undone.",
  新建角色: "New agent",
  编辑角色: "Edit agent",
  新建技能: "New skill",
  编辑技能: "Edit skill",
  新建命令: "New command",
  编辑命令: "Edit command",
  还没有自定义角色: "No custom agent yet",
  "角色决定工具集与提示词。内置的 build / plan / ask 与 general / explore 始终可用，同名的自定义角色会覆盖它们。":
    "An agent defines its tools and prompt. The built-in build / plan / ask and general / explore are always available; a same-named custom agent overrides them.",
  还没有自定义技能: "No custom skill yet",
  "技能是写给模型的说明书：把步骤、约定或命令放进 SKILL.md，模型按说明里的描述判断何时使用。":
    "A skill is an instruction sheet for the model: put steps, conventions or commands in SKILL.md and the model uses its description to decide when to use it.",
  还没有自定义命令: "No custom command yet",
  "命令是常用的提示词模板：写好正文后，在输入框用 /名字 调用，正文会替换掉命令本身。":
    "A command is a reusable prompt template: call it with /name in the composer and its body replaces the command itself.",
  "新建后写入磁盘，改动在下一个新会话生效。":
    "Saved to disk; the change applies to the next new session.",
  "字段改动直接覆盖原文件，未建模的 frontmatter 行原样保留。":
    "Edits overwrite the file; frontmatter keys the app does not model are kept as they are.",
  "小写字母开头，只能用字母、数字与连字符；它也是文件名。":
    "Starts with a lowercase letter; letters, digits and hyphens only. This is also the file name.",
  "小写字母或数字，单词之间用单个连字符；它也是技能目录名。":
    "Lowercase letters or digits with single hyphens; this is also the skill directory name.",
  "小写字母或数字开头，只能用字母、数字与连字符；调用时写作 /名字。":
    "Starts with a lowercase letter or digit; letters, digits and hyphens only. Call it as /name.",
  "全局（所有会话）": "Global (all sessions)",
  保存位置: "Where to save",
  "项目档只对当前项目生效，同名时压过全局档。":
    "The project scope applies to this project only and wins over the global one when names match.",
  "当前没有工作目录，只能存到全局档。":
    "No working directory right now, so only the global scope is available.",
  展示名: "Display name",
  "留空即用文件名。": "Leave empty to use the file name.",
  说明: "Description",
  "写进角色选择器与 subagent 工具的描述，模型按它挑选。":
    "Shown in the agent picker and in the subagent tool description; the model picks by it.",
  类别: "Kind",
  "主模式可作会话模式（与 build / plan / ask 并列），子智能体由 subagent 工具委派。":
    "Primary agents join the session modes (build / plan / ask); subagents are delegated by the subagent tool.",
  可用工具: "Tools",
  "逗号或换行分隔；留空即继承父会话（子角色）或用默认工具集（主模式）。":
    "Separated by commas or newlines; empty inherits the parent session (subagents) or uses the default tool set (primary).",
  模型: "Model",
  "留空即继承父会话。": "Leave empty to inherit the parent session.",
  "只对主模式有效。": "Primary agents only.",
  不指定: "Not set",
  列进工具描述: "List in the tool description",
  "关掉后仍可按名字调用，只是模型看不到它。":
    "When off it can still be called by name — it is just not advertised to the model.",
  从角色选择器里隐藏: "Hide from the agent picker",
  "只对主模式有效；隐藏后仍可按名字使用。":
    "Primary agents only; hidden ones can still be used by name.",
  参数提示: "Argument hint",
  "如 [focus]；显示在 / 菜单的命令名后面。":
    "For example [focus]; shown after the command in the / menu.",
  "留空即取正文首行；显示在 / 菜单里。":
    "Empty uses the first line of the body; shown in the / menu.",
  "必填：模型按它判断何时用这个技能，缺了整条不会被装载。":
    "Required: the model uses it to decide when to run the skill; without it the skill is not loaded at all.",
  命令正文: "Command body",
  提示词正文: "Prompt body",
  "用户输入 / 名字 后，这段文字会替换掉命令本身；$1、$@ 可用参数。":
    "After the user types /name, this text replaces the command itself; $1 and $@ take arguments.",
  "写给模型的指令本身。": "The instruction itself.",

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
  因受阻暂停: "Paused: blocked",
  目标轮次: "Goal rounds",
  目标进行中: "Goal in progress",
  设置预算: "Set budget",
  "输入 token 上限，留空表示不限": "Enter a token limit; leave it empty for no limit",

  // Session activity panel
  会话活动: "Session activity",
  后台服务: "Background services",
  "{{n}} 个服务": "{{n}} services",
  复制地址: "Copy address",
  当前没有进行中的活动: "No activity in progress",

  // Composer commands
  内置动作: "Built-in",
  命令: "Commands",
  技能: "Skills",
  "技能 {{name}}": "Skill {{name}}",
  "模型请求失败，{{seconds}}s 后重试（第 {{attempt}}/{{maxAttempts}} 次）":
    "Model request failed; retrying in {{seconds}}s (attempt {{attempt}}/{{maxAttempts}})",
  "重试 {{attempt}} 次仍失败": "Still failing after {{attempt}} retries",
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
  等待你的输入: "Waiting for your input",
  等待你的回答: "Waiting for your answer",
  等待计划确认: "Waiting for plan review",
  会话已完成: "Session finished",
  会话出错: "Session failed",
  允许通知: "Allow notifications",
  "浏览器还没有允许通知，点「允许通知」授权后才会送达。":
    "The browser hasn't granted notification permission yet — use “Allow notifications” to grant it.",
  "浏览器已拒绝通知，需要在浏览器的网站设置里允许后才能送达。":
    "Notifications are blocked; allow them in the browser's site settings.",
  "系统没有让通知通过，请检查系统的通知设置（macOS 上未签名的应用会被拦下）。":
    "The system didn't deliver the notification — check the system notification settings (unsigned apps are blocked on macOS).",
  "当前环境不支持系统通知。": "This environment doesn't support system notifications.",

  // Session transcript（会话原始记录导出）
  复制会话记录: "Copy session log",
  "复制中…": "Copying…",

  // Usage steps（步级耗时）
  步级耗时: "Per-step timings",
  "{{steps}} 步 · {{turns}} 轮": "{{steps}} steps across {{turns}} turns",
  "{{steps}} 步": "{{steps}} steps",
  当前区间暂无步级数据: "No per-step data in this range",
  每轮步数: "Steps per turn",
  "{{value}} 步": "{{value}} steps",
  平均步耗时: "Average step",
  "中位 {{p50}} · P90 {{p90}}": "p50 {{p50}} · p90 {{p90}}",
  "首 token 占比": "First-token share",
  "平均等首帧 {{value}}": "{{value}} to first token",
  工具耗时占比: "Tool time share",
  已扣掉等用户的时间: "Excludes time spent waiting on you",
  失败步数: "Failed steps",
  上游报错或本轮被中断: "Upstream error or interrupted turn",
  按模型: "By model",
  按思考档位: "By thinking level",
  每日平均步耗时: "Daily average step time",
  "最慢 {{value}}": "Slowest {{value}}",
  "{{date}} · 平均每步 {{value}} · {{steps}} 步": "{{date}} · {{value}} per step · {{steps}} steps",
  每步耗时: "Step time",

  // Usage（使用统计：缓存命中率与趋势口径）
  缓存命中: "Cache hits",
  "缓存读 {{value}} token": "{{value}} tokens read from cache",
  "命中 {{value}}": "{{value}} cached",
  每日缓存命中率: "Daily cache hit rate",
  趋势口径: "Trend series",
  命中率: "Hit rate",
  Token: "Tokens",
  "最高 {{value}}": "Peak {{value}}",
  "{{date}} · 命中 {{rate}} · {{messages}} 轮消息":
    "{{date}} · {{rate}} cached · {{messages}} turns",

  // Desktop shell（桌面端启动时的连接态）
  未连接到本机服务: "Not connected to the local service",
  "未找到服务注册文件 {{path}}，请先启动服务。":
    "Service registration file not found: {{path}}. Start the service first.",
  "无法连接本机服务，请确认服务已启动。":
    "Cannot reach the local service. Make sure it is running.",
  "服务凭证无效，请重启服务后重试。":
    "The service credential is invalid. Restart the service and try again.",

  // Desktop shell（无标题栏窗口里自绘的窗口控件）
  关闭窗口: "Close window",
  最小化窗口: "Minimize window",
  进入全屏: "Enter full screen",
  退出全屏: "Exit full screen",

  // Workbench（右侧第三栏：活动栏 + 侧栏 + 编辑器区）
  工作台: "Workbench",
  收起工作台: "Collapse workbench",
  打开工作台: "Open workbench",
  切换工作台: "Toggle workbench",
  活动栏: "Activity bar",
  文件浏览: "Files",
  源代码管理: "Source control",
  项目文件: "Project files",
  打开的标签: "Open tabs",
  关闭标签: "Close tab",
  关闭其他: "Close others",
  关闭全部: "Close all",
  返回文件列表: "Back to files",
  改动: "Changes",
  历史: "History",
  查看内容: "Show",
  刷新: "Refresh",
  刷新目录: "Refresh folder",

  收起面板: "Collapse panel",
  当前没有工作目录: "No working directory",
  "当前目录不在 git 仓库内，没有可查看的改动":
    "This folder is not inside a git repository, so there are no changes to show",
  已暂存: "Staged",
  未暂存: "Unstaged",
  工作区没有改动: "No changes in the working tree",
  "变更过多，仅列出前一部分": "Too many changes; only the first part is listed",
  还没有提交: "No commits yet",
  "（无标题）": "(no subject)",
  加载更多: "Load more",
  "仅显示前 {{value}} 条": "Only the first {{value}} entries are shown",
  这个提交没有改动文件: "This commit changed no files",
  "二进制文件，git 不展开差异": "Binary file; git does not expand its diff",
  没有差异: "No differences",
  "差异过大，已按上限截断": "The diff is too large and was truncated",
  统一: "Unified",
  双栏: "Split",
  全部展开: "Expand all",
  全部收起: "Collapse all",
  自动换行: "Wrap text",
  全部改动: "All changes",
  "{{value}} 个文件": "{{value}} files",
  堆叠查看全部改动: "View every change stacked",
  "展开 {{value}} 行未变更内容": "Expand {{value}} unchanged lines",
  "{{value}} 行未变更": "{{value}} unchanged lines",
  打开文件: "Open file",
  在左侧项目树里选一个文件: "Pick a file from the project tree",
  复制相对路径: "Copy relative path",
  复制路径: "Copy path",
  复制失败: "Could not copy",
  看项目文件: "Browse project files",
  "在「{{name}}」中筛选文件": "Filter files in 「{{name}}」",
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

  安装: "Install",
  重装: "Reinstall",
  安装插件: "Install plugin",
  尚未安装插件: "No plugin installed yet",
  "插件把技能、命令、角色、钩子与 MCP 服务器打包在一起；可从本地目录、压缩包、npm 或 git 仓库安装。":
    "A plugin bundles skills, commands, agents, hooks and MCP servers; install it from a local folder, an archive, npm, or a git repository.",
  "本地目录来源不复制内容（改完重拉即可生效），网络来源会复制进插件缓存。":
    "A local folder source is not copied (edit it and refresh); other sources are copied into the plugin cache.",
  来源地址: "Source address",
  留空用默认分支: "Leave empty for the default branch",
  "还没有登记市场。": "No marketplace registered yet.",
  "刷新中…": "Refreshing…",
  "安装中…": "Installing…",
  查看插件: "View plugins",
  已安装: "Installed",
  "已安装，可更新": "Installed, update available",
  "该市场还没有插件（或尚未刷新）。":
    "This marketplace has no plugins (or has not been refreshed yet).",
  安装来源: "Source",
  本地目录: "Local folder",
  压缩包链接: "Archive URL",
  "压缩包直链（.zip / .tgz）": "Direct link to a .zip or .tgz",
  "npm 包": "npm package",
  "包名，可带版本：@scope/name@1.2.3": "Package name, version optional: @scope/name@1.2.3",
  "GitHub 仓库": "GitHub repository",
  "Git 仓库": "Git repository",
  "Git 仓库地址": "Git repository URL",
  "owner/repo": "owner/repo",
  "分支 / 标签": "Branch / tag",
  未设置: "Not set",
  "已设置（留空表示不改）": "Already set (leave empty to keep)",
  保存配置: "Save config",
  卸载并清理缓存: "Uninstall and clear cache",
  "组件（{{count}}）": "Components ({{count}})",
  插件: "Plugins",
  随包官方: "Bundled / official",
  本地登记: "Registered locally",
  第三方市场: "Third-party marketplace",
  角色: "Agents",
  钩子: "Hooks",
  扩展: "Extensions",
  命令目录: "Command binaries",
  卸载: "Uninstall",
  "来源已变更，可重拉": "Source changed; reload to pick it up",
  重拉: "Reload",
  移除市场: "Remove marketplace",
  尚未刷新: "Not refreshed yet",
  "{{count}} 个来源": "{{count}} sources",
  "{{count}} 个插件": "{{count}} plugins",
  从目录安装: "Install from folder",
  插件目录: "Plugin folder",
  插件目录的绝对路径: "Absolute path to the plugin folder",
  没有组件: "No components",
  登记市场: "Register marketplace",
  市场名: "Marketplace name",
  "市场名（小写字母、数字与 - . _）": "Marketplace name (lowercase letters, digits, - . _)",
  市场目录: "Marketplace folder",
  "含 marketplace.json 的目录": "Folder containing marketplace.json",
  "状态文件：{{path}}": "State file: {{path}}",
  "来自第三方市场的 {{components}} 不会注入运行时（插件跑起来就是你的权限，故只对随包与本地登记的插件开放）。":
    "{{components}} from a third-party marketplace are not injected. A plugin runs with your permissions, so this is limited to bundled and locally registered plugins.",
  "市场是一份插件清单（marketplace.json），可来自本地目录、url 直链或 git 仓库；刷新后点「查看插件」看目录内容。内置的 Claude 官方市场是 git 源。":
    "A marketplace is a plugin catalog (marketplace.json) served from a local folder, a direct URL or a git repository. Refresh, then browse it with View plugins. The built-in Claude marketplace is a git source.",
};
