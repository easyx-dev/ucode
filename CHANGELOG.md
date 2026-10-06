# 变更日志

**何时更新**：改动涉及项目流程状态时——新增/调整 pnpm 脚本、环境变量、启动方式、依赖、目录结构、
对外接口。纯 bugfix、文案、内部重构不写。

**结构**：简体中文，倒序（最新在上）。

```md
## [未发布]

### 新增
- …

### 变更
- …

### 修复
- …

## [0.1.0] - 2026-09-29

### 新增
- …
```

**分节用词**：新增 / 变更 / 修复 / 移除。不用「优化」「调整」这类模糊词，归入最接近的一节。

**版本号**：跟随根 `package.json` 的 `version`。改动流程状态时 bump 并落成 `## [x.y.z] - YYYY-MM-DD`，
未发布的累积改动留在 `## [未发布]`。

**归档规则**：只保留「未发布」+ 最近 3 个已发布版本；更早的按发布年份移到 `docs/changelog/<YYYY>.md`
（同年合并，最新在上），原位置留一行 `- 更早版本见 [docs/changelog/2026.md](docs/changelog/2026.md)`。

## [未发布]

### 新增

- 侧栏重构与命令面板：顶部功能菜单（新建任务 / 小助理 / 搜索 / 自动化 / 插件市场）、项目与助理两个可折叠分类、
  会话行未读点与悬停置顶 / 归档、侧栏可收起（⌘B）、⌘K 命令面板（操作 / 任务 / 文件，文件查看器预留）。
  契约 `SessionSummary` 增加 `pinnedAt` / `lastReadAt`，新增 `sessions/read`，`sessions/update` 支持 `pinned`，
  SQLite schema v8 增加 `pinned_at` / `last_read_at` 两列；会话列表排序改为置顶优先。
- 新增 **桌面端 `apps/desktop`**（Electron）：自带 Vite + React 渲染层，复用 `@ucode/ui` 与 `@ucode/sdk`，
  外壳沿用 web 的约定（品牌注入、i18n、主题、防闪脚本），只把「URL 导航 + 登录闸门」换成窗口内内存导航
  与连接态。主进程从 `$APP_HOME/app/service.json` 读端点与 `serviceToken`，对发往该服务 `/api/v1` 的请求
  注入 `Authorization: Bearer`（fetch / SSE / 附件 `<img>` 都经此带凭证，凭证不进渲染层）；未运行或
  凭证失效时渲染层给出可读提示。本轮只做开发运行（不打包、不自动拉起服务）：`pnpm dev:desktop`
  （需先起服务，并在 `.env` 放行 `APP_CORS_ORIGIN=http://localhost:5174`）。main / preload 用 esbuild 打包。
- 服务化与鉴权（取代 `TODO.md` 的 P0 条目，方案见 `plans/service-and-auth.md`）：
  - **服务注册**：新增 `$APP_HOME/app/service.json`（`0600`，服务独占写），承载监听地址 / 端口 /
    `serviceToken` / 登录密码；端口 `0` 自选并回写真实端口。新增 `APP_HOST`（默认 `127.0.0.1`），
    未设 `APP_PORT` 时复用注册文件里的端口；`0.0.0.0` 需显式开启并告警。
  - **鉴权**：`/api/v1` 全量加鉴权中间件，放行 `GET /health`、`GET /info`、`POST /auth/login`
    与配对兑换；支持 `Bearer serviceToken`（本机原生客户端免交互）与登录会话 Cookie。
    新增 `auth` 域接口（login / logout / whoami / 活动会话列表与撤销 / 改密码 / 签发一次性配对链接）
    与 `GET /auth/connect/:code` 兑换入口；SQLite schema v7 新增 `auth_session`（只存 token 的 sha256，
    可撤销、改密码撤销全部）；登录按来源 IP 限流。新增 `service` 域的监听地址读写。
  - **契约与前端**：`health` 拆为 `health`（最小存活）/ `info`（发现与 `compatRange`）/ `status`
    （认证后的运行时状态，原 `HealthResponse` 更名 `StatusResponse`）；新增 `auth` / `service` 契约与
    错误码 `unauthorized` / `invalid_credentials` / `forbidden` / `pairing_invalid` / `pairing_expired` /
    `rate_limited`；SDK 传输层带 Cookie 与 401 回调、新增 `auth` store；新增登录页与设置里的
    「远程访问」面板（局域网开关 / 二维码配对链接 / 活动会话 / 改密码）；CORS 收紧为白名单 + credentials。

### 变更

- `brand-html` Vite 插件由 `apps/web/plugins` 移到 `@ucode/brand/vite`，web 与桌面端共用；
  i18n 接线由 `apps/web/src/lib/i18n.ts` 抽到 `@ucode/ui/lib/app-i18n`（`createAppI18n`）。
- `scripts/verify` 的 i18n（硬编码中文）与 tokens（裸色值）扫描范围纳入 `apps/desktop/src/renderer`，
  brand 校验纳入 `apps/desktop`；根 `pnpm check` 覆盖桌面端 typecheck / test。
- `.env.example` 的 `APP_CORS_ORIGIN` 由 `*` 改为示例值并说明桌面端来源（带凭证的跨域不能用 `*`）。

- `TODO.md`：P0「给 `/api/v1` 加鉴权并默认只监听回环地址」已落地。

- 新增会话级**权限档位**（`permissionMode`：`default` / `auto` / `full`）：只决定工具调用命中 `ask` 时
  弹审批还是自动放行，**不改变工具集、也不突破 `deny`**。`auto` 自动批准常规工具（越界目录仍审批），
  `full` 连越界目录一并放行、界面以 warning 色标记。契约 `SessionSummary` / `sessions/create` /
  `sessions/update` 增加该字段，SQLite schema v6 增加 `permission_mode` 列；输入区工具栏新增权限选择器
  （空态禁用、不写草稿），会话分叉不继承、子智能体继承父档位，变更随 `session_updated` 事件下发。
  模式与权限的完整语义见新增文档 `docs/modes-and-permissions.md`。
- 新增 `@ucode/ui`（`packages/ui`）：web 与桌面端共享的 UI 包，含设计 token / 基础样式
  （`src/styles/theme.css`）、基础组件（`src/base`）、业务组件（`src/business`）、Provider
  （`src/provider`，收应用层创建好的 `client`）、SDK store 的 React 绑定 hooks 与纯逻辑；
  web 的组件、hooks 与纯逻辑整体迁入。组件组合式：应用层拼装基础 / 业务组件，或直接用
  `src/presets/workspace-layout.tsx` 的预置组合；当前会话等导航状态由应用层以受控 props 传入。
  `apps/web` 瘦身为外壳（入口、i18n 接线、client 装配、URL 导航），`index.css` 改为
  `@import "@ucode/ui/theme.css"` + `@source` 扫描包内 className；`scripts/verify` 的 tokens / i18n /
  brand 扫描范围纳入 `packages/ui/src`；shadcn 配置移至 `packages/ui/components.json`。
- 新增 `@ucode/sdk`（`packages/sdk`）：把 server `/api/v1` 封装成无 React / DOM 依赖的跨端客户端，
  分两层——`createApis` 是无状态接口层（含传输层封套拆解、baseUrl 与 token/头注入、SSE 解析与
  指数退避重连的事件流），`createClient` 在其上装配各域同步 store（会话列表、消息流、交互、目标、
  模型、health、命令、用量、配置、MCP），store 订阅事件流做增量归并、暴露 `getState` / `subscribe`
  与动作，供 web / 桌面 / TUI 共用；无模块级单例，多窗口多实例互不干扰。
- 新增 `POST /api/v1/attachments`（**请求体为原始字节**，`?name=` 带文件名）与附件元数据表
  （SQLite `attachment`，schema v5）：`id` 是内容 sha256，字节落 `$APP_HOME/app/attachments/<id>`，
  `GET /attachments/<id>` 的 `Content-Type` 取元数据。`referenced_at` 区分临时 / 永久：
  未被消息引用的草稿附件超期（7 天）由服务端清理。上传上限 32MB（`payload_too_large`）。
- 输入区由 `<textarea>` 换成 **Tiptap 富文本编辑器**（只装结构节点与两个 mention，无排版 marks）：
  `/` 菜单分「内置动作 / 命令 / 技能」三组（内置动作立即执行、不落正文；命令与技能序列化为
  `/name` / `/skill:name`，仅文档开头生效），`@` 按会话 cwd 检索文件 / 目录并以 `contextMention`
  引用（发送时剥离为 `contexts[]`）；数据来源 `commands/list` 与 `fs/search`。新增 web 依赖
  `@tiptap/react`、`@tiptap/core`、`@tiptap/pm` 及 document / paragraph / text / hard-break /
  mention / suggestion / placeholder 扩展。
- 输入区附件：粘贴 / 拖拽即上传到服务端，编辑器上方附件行显示图片缩略图（可点开预览）或文件
  chip、可移除；草稿只存附件视图，发送时按 id 引用，发送失败原样回填。草稿期上传的附件在服务端
  是「临时」状态（`referenced_at` 为空），未被消息引用的按 TTL（7 天）回收；图片走原生 vision，
  非图片（pdf / word 等）本期只存与引用。
- 内置命令补齐到 12 个（`/new` `/rename` `/archive` `/fork` `/stop` `/compact` `/models`
  `/thinking` `/mode` `/settings` `/goal` `/help`）：草稿态（无会话）的 `/` 菜单只列不需要会话的命令；
  `/models` `/thinking` `/mode` 用受控弹出层就地打开工具栏里的同一个选择器，`/rename` 与侧栏共用
  重命名对话框（对话框由 App 承载），`/archive` `/fork` 接会话动作，`/help` 列出全部命令。
- `fs/search` 改为对**相对路径**做模糊匹配，与 opencode 同口径：候选来自 pi 的 `find`（fd，尊重
  `.gitignore`、含隐藏文件，目录带尾随 `/`），再用 `fuzzysort` 匹配整条路径并排序，因此 `src/`、`./`、
  `src/a` 等路径片段能直接命中；server 新增依赖 `fuzzysort`。候选按 base 缓存 10s。
- 新增 `POST /api/v1/messages/compact`（手动压缩上下文；后台执行，进度走 `compaction_*` 事件），
  对应输入区的 `/compact` 内置动作。
- 新增**自定义 primary agent**：全局 `$APP_HOME/agents/*.md` 与项目配置目录下的 `agents/*.md`
  （cwd 祖先链，近者优先）均可定义 `mode: primary | subagent | all` 的角色；primary 允许覆盖内置
  `build` / `plan` / `ask`。`mode` 契约放宽为 slug 字符串（不再限定枚举），`sessions/create|update`
  按 agent 注册表校验；新增 `POST /api/v1/agents/list`。自定义角色目录由 `$APP_HOME/agent/agents`
  移到 `$APP_HOME/agents`；MCP 扩展改为按「默认工具集」判定加载（自定义只读角色不再误连）。
- 新增**命令与技能资源发现**：全局 `$APP_HOME/{skills,prompts}`、项目 `.ucode/{skills,prompts}`
  （从会话 cwd 沿祖先链收集，止于项目根）、兼容 `.agents/skills`；同名优先级
  项目 `.ucode` > 项目 `.agents` > 全局 `$APP_HOME` > 用户 `~/.agents`（pi 侧 first-wins）。
  会话装配改为只认这些目录（禁用 pi 默认的 `agentDir/skills` 与 `cwd/.pi/*`），技能清单由 pi
  自动注入系统提示词。目录解析与装载见 `server/src/agent/assets/`。
- 新增 `POST /api/v1/commands/list`（契约域 `commands`）：按 `sessionId` / `cwd` 解析工作目录，
  列出可用的提示词命令（`/name`）与技能（`/skill:name`）及其来源。
- 新增 `@` 上下文、图片附件与附件路由的服务端能力：`agent/context`（展开文件 / 目录引用，限会话 cwd 内、
  `<context>` 不可信包裹）、`agent/image`（pi `resizeImage` 归一化到 2000×2000 / 5MB）、
  `agent/attachment`（sha256 内容寻址附件库，落 `$APP_HOME/app/attachments`）、
  `GET /api/v1/attachments/<id>` 字节路由（非 JSON 例外，带缓存头与 ETag）、`POST /api/v1/fs/search`
  受限检索；`messages/prompt` 接入 `contexts` / `images`，`MessageBlock` 的 image 区块改为
  `{ id, mimeType, url }`。
- 契约新增（部分待 web 阶段接入）：`agents` 与 `commands` 域、`IMAGE_MIME_TYPES` /
  `PROMPT_MAX_IMAGES` / `PROMPT_MAX_CONTEXTS` / `MESSAGE_IMAGE_MAX_BASE64_BYTES` /
  `COMMAND_ASSET_SOURCES` / `AGENT_KINDS` / `AGENT_SOURCES` 常量、错误码 `image_invalid`，
  以及 `MessageBlock` 预留的 `file` 变体。
- 新增开发期源码定位：接入 `@tanstack/devtools-vite`，dev 下给 JSX 注入 `data-tsd-source="文件:行:列"`，
  可在 Chrome DevTools 的 Elements 面板直接定位元素来源；仅 dev 生效、生产构建剥离，并用
  `injectSource.ignore.components` 排除基础 UI 组件。
- 新增**目标模式**：`/goal <目标>` 给当前会话设目标，每轮落定后由服务端一次独立校验模型调用判断是否达成，
  未达成自动续跑，直到达成、用户暂停 / 清除，或触发止损。目标是**会话属性**（叠加在 `build` 模式上，
  不改变工具集与权限），仅编码模式可设；切走模式、当前轮被中断、生成出错都会暂停。新增
  `goals/set|status|pause|resume|clear` 接口（`goalSetInputSchema`：`sessionId` / `objective` /
  可选 `tokenBudget`）；`session` 表新增 `goal_state`（schema v4，单列 JSON 存状态）；`sessions/info`
  响应追加 `goal`；新增 `goal_update` 事件。三层止损：连续 3 轮无工具调用、可选 token 预算、
  默认 25 轮自动续跑上限（均转为暂停并保留目标）。前端在输入区上方新增目标栏，`/goal` 命令由客户端识别。
- 新增**使用统计**：从 pi 会话记录里的 `usage`（assistant 消息 / `usage` 条目 / compaction）聚合 token 用量，
  **不落库**，按会话文件 mtime 内存缓存。新增 `stats/summary` 接口（`statsSummaryInputSchema`：可选 `days`），
  `sessions/info` 响应追加 `usage`；子会话与分叉会话一并计入并按来源标注。界面在对话区头部显示本会话用量，
  点击打开全局统计对话框（总量、按模型、按会话、工具调用次数，支持全部 / 30 天 / 7 天）。无 DB / schema 变更。
- 新增**编辑历史**：在用户消息上「编辑并重新发送」，从该消息之前继续推进；被放弃的后续内容保留在会话
  文件里（旧分支），不删除。新增 `messages/edit` 接口（`messageEditInputSchema`：`sessionId` /
  `entryId` / `text`），复用 pi 的 `AgentSession.navigateTree`（`summarize: false`）把活动分支移回该
  消息的父节点再重发；会话在跑 / 压缩 / 有排队消息时返回 `session_busy`，非活动分支或非用户消息返回
  `invalid_request`。新增 `transcript_reset` 事件，客户端据此丢弃本地历史并重新取快照。无 DB / schema 变更。
- 新增**会话分叉**：从任一条已落盘消息「从此分叉」，生成一个独立的新会话（内容为该消息及其之前的历史，
  可继续对话），原会话不变。新增 `sessions/fork` 接口（`sessionForkInputSchema`：`sessionId` /
  `fromEntryId?` / `name?`，缺省分叉点为当前叶子）；`session` 表新增 `forked_from_session_id`
  （schema v3 追加迁移），`SessionSummary` 带出来源 id 供界面显示「分叉自」。分叉复用 pi
  `SessionManager.createBranchedSession`（新会话文件 header 的 `parentSession` 指向源文件），
  新会话继承源的 cwd / 模式 / 模型 / 档位；源会话在跑、未落盘、已归档或分叉点非法时给出可读错误。
  子智能体会话不可作为分叉源。
- 子智能体支持**自定义角色**：`$APP_HOME/agent/agents/*.md`（frontmatter + 提示词正文，文件名即角色
  slug）。可声明 `name` / `description` / `tools`（缺省或 `inherit` 继承父会话，否则为工具名白名单）/
  `model` / `thinking` / `advertise`；与内置 `general` / `explore` 合并、同名覆盖，与主模式
  （`build` / `plan` / `ask`）同名则拒绝。frontmatter 复用 pi 的 `parseFrontmatter`（无新增依赖），
  未知字段直接报错——避免把 `tools` 的拼写错误静默退回「继承」而放大能力；坏文件跳过并记入日志，
  不影响其余角色。`subagent` 工具的可用角色与描述按注册表动态生成，`advertise: false` 的角色
  不进描述但仍可按名调用。
- 子智能体支持**续跑**：`subagent` 工具新增可选 `task_id`，命中「本会话的直接子会话」时在该子会话上
  继续（校验归属 / 角色一致 / 未归档），不新建；未指定 `agent` 时沿用原子会话的角色。
- 新增**子智能体**（`build` / `plan` / `ask` 都可委派）：父会话经 `subagent` 工具把一段独立任务
  交给真实子会话（`general` 继承当前能力 / `explore` 只读），前台运行、只回传最终文本。
  子会话能力 =「父会话 ∩ 角色定义」，工具取交集、权限取较严，保证只读父会话不会靠委派越权；
  子会话默认不能再派子会话。
  子会话是真实会话：`session` 表新增 `parent_session_id` / `agent`（schema v2 追加迁移），
  落 JSONL、默认不进主列表、可按父会话下钻；`sessions/list` 支持 `parentSessionId` 过滤。
  子会话触发的审批 / 提问归属父会话并标注来源（`interactions` 契约新增 `sourceSessionId` /
  `sourceDescription`）。角色与能力解析落在新的 `agent/agents/`，会话装配从「按模式」改为「按角色能力」；
  只有继承默认工具集的子会话（`general`）才挂 MCP / `tool_search` 扩展，`explore` 与只读模式下的子会话不连。
- 子智能体**流式进度**：新增 `subagent_start` / `subagent_end` 两个事件，只建立 / 解除
  「父会话 `toolCallId` ↔ 子会话 id」关联，**不重发**子会话事件——子会话自身的帧已在同一事件流上按其
  sessionId 广播，前端据此把子帧归入父会话里对应工具卡的嵌套视图（可折叠）；进度不落盘，刷新后不重建。
- 子会话**导航**：侧栏父会话条目可下钻列出子会话（`SessionSummary` 新增 `childCount`，仅在有子会话时
  显示展开箭头），点进子会话切到该会话视图并可一键「返回父会话」；子会话只读查看，输入区替换为只读提示。
  归档父会话时**级联归档**其全部子会话（行、JSONL 与工作区目录仍保留）；父会话里子智能体工具卡
  新增「打开子会话」入口（仅实时可见）。
- 接入 pi 内置 **MCP（Model Context Protocol）**：`build` 模式加载 `$APP_HOME/agent/mcp.json`
  （用户级；自定义 `loadConfig` 排除 pi 默认的项目级 `.pi/mcp.json`），并在 `session_start` 时连接；
  `plan` / `ask` 不加载该扩展——连接成功会激活 `codemode`，绕过只读白名单。
  MCP 工具沿用 pi 默认的 `codemode` 暴露，权限侧对未命中显式规则的 `mcp__*` 调用按服务器
  annotations 兜底（只读放行，其余审批），显式规则与会话恒允照常覆盖。
  新增 `mcp/list` / `mcp/upsert` / `mcp/delete` 接口与 `mcp` 契约域（按会话 agentDir 读取该文件，
  评测 / 测试覆盖 agentDir 时随之隔离；读写保留未知顶层键与未建模的条目字段，坏配置可覆盖修复）；
  设置对话框新增「MCP」区块，可增删改服务器、切换启用与暴露方式，改动写入该文件、新会话生效。
  暴露方式覆盖 pi 的五种：`codemode` / `codemode-deferred` / `deferred` / `direct` / `hidden`；
  `build` 额外注册 `tool_search`（默认不激活，出现 `deferred` 服务器时由 MCP 扩展自动激活并加载工具），
  `plan` / `ask` 不注册。
- 新增**项目级记忆（Memory）**：`config.json` 增加 `memory: { enabled }`（默认关闭），
  设置对话框新增「记忆」区块。开启后每轮对话彻底落定（`agent_settled`）会在后台用当前模型回顾最近交流，
  把值得长期保留的事实写成 `$APP_HOME/app/memory/projects/<project>/*.md`，
  并更新同目录的 `MEMORY.md` 索引；下一会话经 `agentsFilesOverride` 把索引并入上下文。
  记忆按会话工作目录归属，目录名取「末段 + 绝对路径短哈希」；`remember` / `forget` 两个自研工具
  （仅 `build` 模式注册）让模型按用户明确指令直接增删。契约新增 `memory` 配置与 `MemoryView`。
- 新增会话工作区：`$APP_HOME` 下多一层 `workspace/`（`env.workspaceRoot`，启动时一并创建），
  未绑定目录的会话落在 `workspace/<sessionId>`，它同时是这类会话的 cwd
  （此前回落到 `$APP_HOME`）；绑定目录的会话在用户自己的目录里干活、不建工作区。
  目录在会话要跑时才建、路径由会话 id 派生不落库。
  对话区头部新增「目录」入口，用只读浏览窗口查看该会话的工作目录（复用 `fs/list`）。
- 会话改为**首条消息时才创建**：输入框常驻可用，没有会话时它是「草稿阶段」——第一条消息发出时
  客户端先 `sessions/create`（带上草稿里的目录 / 模型 / 档位 / 模式），拿到 id 再 `messages/prompt`；
  服务端不再隐式建会话，创建只有一条路径。选目录的入口也不再预建会话，而是把目录绑到草稿上。
- 新增**输入区草稿**：未发送的文本与初始设置按上下文（草稿阶段 / 每个会话）持久化在 localStorage，
  关掉应用再打开会连同内容一起恢复，并停留在草稿阶段（不会被自动带进别的会话）；
  发送成功、会话归档时清掉对应草稿。
- 会话删除改为**归档（软删）**：新增 `POST /sessions/archive` 与 `SessionSummary.deletedAt`，
  归档只写 `deleted_at`，行、JSONL 与工作区目录全部保留，列表默认过滤已归档的会话。
- 侧栏分「项目区 / 助理区」两段：项目区按会话 cwd 归组（组名取目录末段），助理区（助理根之下）
  平铺展示；不再有「项目登记表」，分组完全由目录决定。
- 启用内置 `codemode` 工具（`build` 模式）：模型可写 JavaScript，在沙箱内并行调用其它工具、
  先过滤大输出再回模型。
- 新增助手模式 `build` / `plan` / `ask`（默认 `build`）：模式 = 工具选择 + 权限规则 + 提示词片段，
  经 `server/src/agent/modes` 声明。`plan` / `ask` 均为只读（工具集不含 `edit` / `write` / `bash`，
  只剩 `read` / `grep` / `find` / `ls` / `webfetch` / `websearch`）；模式约束随系统提示词注入
  （阶段 4 起由自研提示词承担，见下方「系统提示词源」条目），
  切换模式会重建会话实例。composer 底部新增模式选择器，模式持久化到 `session.mode`。
- plan 模式重做：新增自研工具 `present_plan`（只在 plan 模式注册），模型产出计划后调用它收尾。
  前端在本轮以 `present_plan` 收尾时，用「计划决策表单」替掉输入区：
  「批准并执行」切换到 `build` 模式并自动发一条「计划已批准，请开始执行。」，
  「提交反馈」则带着意见留在 plan 模式继续讨论。计划只作为对话消息，不落盘。
- 新增权限引擎 `server/src/agent/permissions`：声明式规则（工具名 + pattern + `allow` / `ask` / `deny`，
  `*` 通配、**最后命中者胜**），经 pi 内联扩展（`DefaultResourceLoader({ extensionFactories })`）
  挂到 `tool_call` 上拦截。默认规则：`.env` / `.env.*` 的读写阻断（`.env.example` 放行）、
  工作目录之外的路径走审批（`external_directory`）。「本会话恒允」按判定给出的范围追加一条会话级
  allow 规则（越界检查按父目录，如批准 `/etc/hosts` 只记住 `/etc/**`），而不是笼统放行整个工具。
- 新增交互请求通道（「服务端提问、前端回答」，当前服务权限审批）：新增 `interactions/list` /
  `interactions/respond` 两个接口，事件流新增 `interaction_request` / `interaction_resolved`；
  审批超时（`PERMISSION_APPROVAL_TIMEOUT_MS`）与会话删除按拒绝结算。
  前端新增权限审批弹窗（允许一次 / 本会话恒允 / 拒绝）。
- 新增 `question` 自研工具：模型在信息不足时经交互通道向前端提问（每题给若干选项、可多选，
  用户也可自填或跳过），前端新增提问弹窗。答复以 `interactions/respond` 的 `kind: "question"`
  回传后本轮继续；等待超时（`QUESTION_TIMEOUT_MS`）或本轮中断 / 会话归档时以可读错误结束，避免工具调用悬空。
  `build` / `plan` / `ask` 三种模式都可提问（只读模式的工具白名单已纳入）。
- 契约 `PendingInteraction` 由单一的权限审批改为按 `kind` 判别联合（`permission` / `question`），
  `interactionRespondInputSchema` 同步新增提问分支（`answers: string[][]`），`QuestionItem` 描述问题与选项。
- 契约新增 `PERMISSION_ACTIONS` / `PERMISSION_DECISIONS` 常量与 `interactions` 域（请求 / 响应类型）。
- 新增自研工具：`webfetch` 抓公网链接并用 `turndown` 转 markdown
  （响应体上限 5MB、超时默认 30s / 最长 120s、目标准入拦住回环 / 私网 / 链路本地与云元数据并逐跳校验重定向、
  交给模型的正文再按 pi 内置工具同档的 50KB 截断、返回内容以 `<fetched>` 边界包裹并中和正文里的同名标签，
  声明为不可信内容）；`websearch` 走 provider 抽象，先接 `tavily` / `searxng` / `brave`，
  前置条件（key 或实例地址）缺失、写错时返回可读错误而非崩溃。
  两者经 `customTools` 注入，并带系统提示词片段与注入隔离说明。
- 会话工具集启用 pi 内置只读检索工具 `grep` / `find` / `ls`（此前只有 read / bash / edit / write），
  内置清单与自研工具名由 `agent/tools/index.ts` 声明。
- `config.json` 新增 `websearch: { provider, apiKey, baseUrl }`（默认 `tavily` + 空值）：
  `config/update` 可局部更新（`apiKey` 留空表示沿用已保存的 key，`baseUrl` 留空即清空），
  `config/info` 返回脱敏视图（`apiKeyMasked` / `baseUrl` / `configured`）；
  设置对话框新增「联网搜索」区块（自建实例型 provider 改填实例地址），
  契约新增 `SEARCH_PROVIDERS` / `SEARCH_PROVIDER_LABELS` / `KEYLESS_SEARCH_PROVIDERS` 与 `WebsearchView`。
  provider 三家：`tavily`（默认，免费档不用绑卡）、`searxng`（自建实例，无 key）、`brave`（新用户已需绑卡）。
- 新增依赖 `turndown`（HTML → markdown）与 `typebox`（自研工具的参数 schema），`@types/turndown` 为开发依赖。
- 新增 `server/src/agent/`（会话装配层）：`session-config.ts` 把「会话覆盖值 + 运行时」收敛成
  `createAgentSession` 参数，`pool.ensure` 改为经它组装；后续的模式 / 工具集 / 自研提示词都从这里汇入。
- 新增系统提示词源开关 `APP_PROMPT_SOURCE`（`custom` / `pi`，默认 `custom`，重启生效）：
  `custom` 整段替换 pi 默认前缀与 tools / rules / docs 三节（`systemPromptOverride`），正文以
  opencode 的提示词分节与规则为蓝本移植改写（去掉 CLI 语境与 opencode 专有入口、工具名对齐本仓库、
  「禁止写注释」改为遵循项目 AGENTS.md），并按模式裁剪工具使用指引；`pi` 保留 pi 默认提示词，
  只追加身份、模式约束、外部内容边界，供评测对照。两套源的取舍由真实模型评测决定，不靠文案观感。
- 系统提示词预留两个扩展口子：**语言目录**（`agent/prompt/locales`，实现 `PromptCatalog` 即新增语言，
  当前仅 `zh-CN`）与**模型族变体**（`agent/prompt/variant.ts`，按模型解析变体，当前统一 `default`，
  差异文案写在目录的 `variantNotes` 里）。模式约束文案一并收进语言目录，`agent/modes` 只留
  工具选择与权限规则。
- 新增提示词评测 `pnpm eval`（`server/scripts/eval.ts`，根脚本同名转发）：用真实模型跑固定用例，
  抓工具调用与最终回复做断言，支持 `--source pi,custom` 按源对比，不进 `pnpm check`；
  `smoke` / `eval` 共用的本地端点装配抽到 `server/scripts/lib/local-gateway.ts`。
- 新增会话模式 `mode`（`build` / `plan` / `ask`，默认 `build`）：会话契约新增 `mode`，
  `sessions/create|update` 可设置，`sessions/list|info` 返回。
- 新增 `node:test` 单元测试（server），根 `pnpm test` 递归执行，`pnpm check` 纳入测试；
  `scripts/verify` 新增 tests 校验（有测试用例的包必须声明 `test` 脚本，避免被 `pnpm -r test` 静默跳过）。
- 新增 `fs` 域（`fs/list` / `fs/mkdir`）：文件系统浏览（`path` 省略时从用户 home 开始，条目带
  `type` / `size` / `updatedAt`，目录在前，`q` 按名称模糊过滤）与新建目录；设计为后续文件预览器复用。
  契约新增 `FS_ENTRY_TYPES` / `FS_LIST_FILTERS` 常量，`ERROR_CODES` 新增 `path_not_found` /
  `path_exists` / `mkdir_failed`。
- 新增国际化（基于 i18next）：web 设置 → 外观新增「语言」切换（中文 / English，母语名展示），
  偏好存 `localStorage`，首屏由 `index.html` 内联脚本同步 `<html lang>`，dayjs 的展示语言随之切换。
- 新增 `packages/i18n`（`@ucode/i18n`）：跨端 i18n 运行时与共享文案的单一事实源，只依赖 `i18next`
  （不依赖 React / DOM）。提供 house 配置 `createI18n`（`i18next.createInstance`，不导出全局单例）、
  共享目录（`common` 协议级 / `domain` 错误码 / `ui` 产品界面词汇，web / Electron / TUI 共用）、
  以及 `error-messages.ts` 的「`ERROR_CODES` → 文案 key」映射；各端补充文案走 `appCatalogs`。
- 服务端**不做本地化**：失败封套与 SSE 错误帧只给 `code` + 固定中文兜底 `message` + 插值 `params`；
  客户端（`describeError` 与对话区错误条）按 `code` 查 `errorMessageKeys` 渲染当前语言，查不到时回落 `message`。
  web 不再发送 `X-Locale`。
- 新增 `packages/contracts/src/locale.ts`：`LOCALES` / `Locale` / `DEFAULT_LOCALE` / `isLocale`；
  `ApiFailure` 与 SSE 错误帧新增可选 `params`，新增 `ErrorCode` 类型。
- 文案分层：共享文案都在 `packages/i18n/src/locales/`（`common` / `domain` / `ui`）；
  key 用中文原文（长文案用中文摘要 key + 完整值），插值用 `{{占位名}}`，运行时按语言扁平合并、组间不得重名。
- 新增 i18n 校验（`scripts/verify/checks/i18n.ts`，作为第 5 项接入 `scripts/verify`）：每组中英 key 齐平、
  组间无重复 key、`errorMessageKeys` 映射到的 key 必须在目录里、`apps/web/src` 与 `packages/i18n/src`
  禁止硬编码中文（注释、`logger` / `console` 日志与 `i18n-ignore` 除外）。
- `@ucode/brand` 新增 `localeStorageKey`（由 slug 派生）；`apps/web/plugins/brand-html.ts` 注入 `%BRAND_LOCALE_KEY%`。
- 新增依赖 `i18next`（web / `@ucode/i18n`）与 `react-i18next`（web）；server 不引入 i18n 依赖。
- 新增 pi 内置供应商目录：`models/list` 返回 pi `providers/all` 里可用一把 API key 接入的 32 个供应商
  （deepseek / minimax / zai / kimi-coding / xiaomi / qwen-token-plan / openai / anthropic / xai / openrouter …），
  以及它们完整的模型参数（`reasoning` / `thinkingLevelMap` / `contextWindow` / `maxTokens` / `cost` / `compat` 等）。
  设置页新增「接入内置供应商」目录，选中后只需填 apiKey。
- 内置供应商在 `config.json` 里只记 `id` 与 `apiKey`，端点与模型清单由 pi 提供，pi 升级后自动生效。
- 模型字段补齐到 pi 的 `Model`：新增 `thinkingLevelMap`、`samplingParams`、`inputLimits`、`promptCache`、
  `baseUrl`、`cost.tiers`；provider 级新增 `compat` 与 `authHeader`。
  设置页的模型表单同步暴露输入类型（文本 / 图片）与推理等级映射（按需添加某档并指定厂商取值，
  留空表示该档不支持，未添加的档位按厂商默认）；
  其余字段（`promptCache` / `samplingParams` / `headers` / `inputLimits` / `compat`）不进表单，
  仍可手写 `config.json` 或走接口，编辑模型时原样保留。
- 新增 `packages/brand`（`@ucode/brand`）：品牌名（`name` / `title` / `slug`）与图片资源（浅色 / 深色 logo、favicon）的单一来源，
  图片以 `src/assets.ts` 的 import 暴露（格式任意，换格式只改扩展名）；web 构建期由 `apps/web/plugins/brand-html.ts`
  注入浏览器标题与主题存储键，侧栏标识、空态水印也改读品牌包。
- 新增品牌校验（`packages/brand/scripts/verify.ts`，作为第 4 项接入 `scripts/verify`，随 `pnpm check` 执行）：
  品牌值合法、资源齐备、源码无硬编码品牌名；另加应急脚本 `packages/brand/scripts/replace.ts`（`pnpm brand:replace`）。
- 品牌包新增 `appHomeDirname`（默认 `~/.<slug>`，由品牌 slug 派生）：`APP_HOME` 未设置时用它作为主目录名；
  SQLite 文件名改为通用名 `app.db`（放 server 常量，与品牌无关）。
- 新增 `POST /api/v1/events`：全局 SSE 事件流，承载所有会话的实时事件，带 `seq` 会话内序号与 15s 心跳；
  生成生命周期与调用方连接解耦，刷新 / 断线后重取快照即可接续。
- `messages/list` 响应新增 `running`（是否有活跃生成）、`seq`（快照序号）与 `liveMessageId`（在途消息 id），
  并用活跃会话的 `streamingMessage` 投影正在生成的正文，刷新后不再丢失在途内容。
- `sessions/list` / `sessions/info` 的会话摘要新增 `running` 字段。
- web 新增 `lib/event-stream.ts`（全局事件流单例连接 + 指数退避重连）与 `hooks/use-session-stream.ts`
  （快照 + 按 `seq` 切分接续实时帧），会话侧栏与对话区头部显示「生成中」。
- 新增项目内命令 `/review`（`.agents/commands/review.md`，经 `.opencode/commands/review.md` 软链被 OpenCode 发现）：
  按输入判定审查范围（未提交改动 / 提交 / 分支 / PR），产出可执行的代码审查反馈。
- server 引入 SQLite（Node 内置 `node:sqlite` 的 `DatabaseSync`，无新增依赖）：新增 `db/` 模块，
  用 `PRAGMA user_version` 管理 schema；`session-repository` 保存会话的元数据覆盖值与列表索引
  （名称、预览、创建/更新时间、JSONL 路径）。需 Node ≥ 24，启动会打印一条实验特性警告。
- `APP_HOME` 目录按「谁的资产」分两层：`pi/`（pi 私有：`models.json` / `auth.json` / `sessions/`）与
  `app/`（应用自有：`config.json` / `app.db`）；不再使用 `agent/` 与根目录的 `config.json`。
- 新增项目规范体系：根 `DESIGN.md`（设计系统）与 `docs/{database,api,components}.md`；
  `AGENTS.md` 增加「规范索引」并收敛为索引，细则下沉到各文档。
- 新增 `scripts/verify/`（`pnpm verify`）：SQLite 迁移版本连续性、契约字段命名与 `*Request`/`*Input` 配对、
  业务组件禁用裸色值与非语义颜色 utility 三项校验，接入根 `pnpm check`。
- web 新增深色模式：`ThemeProvider`（`next-themes`）、设置里的浅色 / 深色 / 跟随系统切换、
  `index.html` 首屏防闪脚本。
- web 新增通用组件 `SegmentedControl`（分段控件）与 `SettingsGroup` / `SettingsRow`（设置行卡片）。
- 设计 token 新增功能色（`success` / `warning` / `info`）与图表色（`chart-1..5`），与单色品牌色相互独立。
- 设计 token 新增 `--overlay`（遮罩）：浅色 `oklch(0 0 0 / 10%)`、深色 `oklch(0 0 0 / 40%)`；
  对话框遮罩由 `bg-black/10` 改用 `bg-overlay`。
- 前端新增依赖 `dayjs`：会话列表的相对时间与消息时刻改用它（`relativeTime` 插件 + `zh-cn` locale），
  替换手写的差量计算。列表文案随之变为「几秒前 / 55 分钟前 / 1 天前」。
- 新增**接口参考文档**：`pnpm api:docs` 从 `packages/contracts/` 生成 `docs/api-reference.md`，
  逐接口列出请求参数（类型 / 必填 / 默认 / 约束 / 说明）与响应结构，作为 `docs/api.md` 的清单补充；
  `pnpm check` 新增 `api-docs` 校验：重生成后与文档逐字节比对，并把端点清单与 server 路由双向核对。
- 历史消息把用户消息里展开的 `<skill>` / `<context>` 块还原成 chip，只显示用户真正输入的内容
  （此前会看到整段展开的技能与文件内容）。

### 变更

- 会话列表 / 模型 / MCP 改为事件驱动：`EVENT_NAMES` 新增 `session_created` / `session_updated`
  （载荷 `{ session, usage? }`）/ `session_archived`，控制帧新增 `config_changed` / `mcp_changed`，
  移除 `session_info_changed`（并入 `session_updated`）。客户端据此删除会话列表、模型目录、MCP 的
  轮询刷新；`SessionSummary` 的 `usage` 由 `session_updated` 携带。
- 客户端错误类型 `SdkError` 更名为 `ApiError`；事件订阅面更名为 `events.onEvent` / `onError` /
  `onConnected` / `onDisconnected`。
- i18n 约定进一步收敛为「key 即中文文案」：长文案也用 key 本身（不再用 `.说明` 之类的摘要 key），
  `packages/i18n/src/locales/*/zh-CN.ts` 只剩纯占位模板 `失败提示.模板`；`scripts/verify` 的 i18n
  校验改为「zh ⊆ en + zh 只允许摘要 key（`分组.用途` 形态）+ 禁止 key === value 冗余 + 摘要 key
  必须有中文」，错误码文案的 key 一并换成完整中文。

- 附件改为「先上传、再按 id 引用」：`messages/prompt` 的 `images`（内联 base64）改为
  `attachments: [{ id }]`，图片仍由服务端 `resizeImage` 归一化后入库，非图片（pdf / word 等）
  原样入库、正文只附一行引用 `[附件: <name> (id: <hash>)]`（内容解析留给后续）。
  请求体不再内联 base64，去掉约 33% 膨胀与 base64 上限。
  （本地已按中间实现建过 `app.db` 的环境需删除重建：v5 迁移项在提交前被就地修改过。）
- web 去掉本地附件库（删掉 `lib/image-encode.ts`、`lib/draft-store.ts`）：不再在客户端压缩、
  不再需要本地回收；草稿只保存附件视图（`{ id, mimeType, name, size, kind }`），预览直接走
  附件路由。附件在贴图时上传，发送不再等待上传。
- 升级 pi（`@earendil-works/pi-coding-agent` `^0.99.1` → `^1.0.2`）；MCP 暴露方式收敛：
  pi 1.0 起 `codemode-deferred` 已成为 `codemode` 的运行时别名，`MCP_EXPOSURES` 同步删去该项，
  存量写 `codemode-deferred` 的 `mcp.json` 按「不做历史兼容」不迁移，改成 `codemode` 即可。
  另随 pi 1.0 起 MCP 工具名把非字母、数字、下划线的字符（含 `-` `.`）转为 `_`，
  含这类字符的服务器名与工具名在工具调用里的实际名字随之变化。
- 根 `pnpm verify` / `pnpm check` 改由 `tsx` 运行 `scripts/verify/index.ts`（原先用 `node`），
  以便校验脚本直接复用契约的 TS 源码；根目录新增 devDependencies `tsx` / `typescript`
  （`typescript` 用于生成器读取响应类型）；契约包导出 zod 的 `toJSONSchema`，供生成器把请求
  schema 转 JSON Schema，避免与根依赖解析出两份 zod。
- agent 数据目录由 `$APP_HOME/pi` 更名为 `$APP_HOME/agent`（去掉上游品牌字样，`env.piDir` → `env.agentDir`）。
  开发初期不做兼容：旧 `pi/` 目录不会被自动迁移，按新布局删除重建即可（见 `AGENTS.md`「编码原则」）。
- `session` 表从 16 列收敛到 11 列：删 `workspace_dir` / `pi_name` / `pi_cwd` / `persisted` /
  `entry_count` / `message_count`，新增 `deleted_at`；`reconcile()` 不再从 JSONL 还原元数据
  （外部导入能力放弃），只做「有行无文件」的清理；schema 版本收敛为 1，本地删 `app.db` 重建。
- 删除 `project` 表与 `/api/v1/projects/*` 四个接口、前端项目空间相关入口与文案。
- 删除草稿 TTL 清理（`deleteStaleDrafts` 与环境变量 `APP_DRAFT_TTL_MS`）：会话在首条消息时创建，
  空行由对账清理；工作区孤儿清理保留但去掉 TTL（目录在会话要跑时才建，DB 行必然早于它存在，
  「无行」即「无主」）。
- `health.workspace` 改指助理根目录（原为 agent 工作目录）。
- 会话列表不再返回 `messageCount`（前端不展示）。
- 未知会话不再被放行：`messages/prompt` / `sessions/update` 对不存在的 `sessionId` 返回 404；
  会话工作目录的推导随之只认已有记录，删掉了「查不到就回落到 `$APP_HOME`」那条分支
  （`env.workspaceDir` 一并删除）。
- 升级 pi（`@earendil-works/pi-coding-agent` `^0.87.1` → `^0.99.1`）。
- 工具选择机制改按模式分路：`build` 不再传 `tools` 白名单，改用 `defaultTools`（内置工具 + `codemode`），
  pi 扩展与后续 MCP 注册的工具不再被白名单静默过滤；`plan` / `ask` 仍用显式的只读白名单。
- 失败封套与 SSE 错误帧新增可选 `params`（错误文案的插值值）；前端仍按 `code` 分支。
- `APP_HOME` 默认值由仓库内 `.tmp/.ucode` 改为用户主目录 `~/.ucode`；SQLite 数据库文件名由 `ucode.db` 改为通用名 `app.db`。
- `sessions/list` / `sessions/info` 改为读 SQLite 索引，不再每次 `SessionManager.listAll()` 全量扫描解析 JSONL；
  列表的过滤与排序下推到 SQL。启动时 `reconcile()` 以 JSONL 为准对齐索引，每轮生成落定后回写一次。
- 会话覆盖值从 `session-state.json` 迁到 SQLite（`config/session-state.ts` 移除），写入由整文件重写变为单行更新。
- `core/` 新增 `session-index.ts`（pi 会话对象 ↔ 入库索引 / `SessionInfo` 的转换）。
- `POST /api/v1/messages/prompt` 改为投递语义：返回 `{ sessionId, admitted }` 回执，生成在服务端后台继续，
  事件统一走 `/events`（原请求级 SSE 流移除）。
- server `core/` 新增 `event-bus.ts`（会话事件总线，`AgentSession` 入池即常驻订阅）、`projection.ts`
  （在途投影）与 `run.ts`（后台运行），移除 `run-stream.ts`。
- web 的 `hooks/use-session-history.ts` 由 `use-session-stream.ts` 取代；`use-send-message` 不再消费 SSE。
- 设计 token 改为「灰度外壳 + 白色内容卡」分层：`background` 变为外壳灰、`card` / `popover` 为白面；
  `--radius` 由 `0.625rem` 提到 `0.75rem`；品牌色固定为浅色近黑（`#181818`）/ 深色近白。
  全站表面观感随之变化。
- web 界面重整：侧栏加分组标签与相对时间、会话行改选中 pill（不再显示消息数与模型标记）；模型与思考档位
  选择器从头部移入 Composer（白卡 + 上下文行 + 底部工具行）；空态改为水印 + 问候语 + 起始建议 chips；
  模型选择器改为可搜索、按 provider 分组、带说明的弹出层；设置对话框增加「外观」区块。
- **破坏性**：`MessageDTO.timestamp`（毫秒数字）改为 `createdAt`（ISO 8601 UTC），全站时间口径统一。
- **破坏性**：`HealthResponse.version` 更名 `apiVersion`，取值来自新增的 `API_VERSION` 常量，与 `API_BASE_PATH` 同源。
- **破坏性**：契约抽出响应基类型 `ListResult` / `SessionScoped`，会话列表、删除、受理、中断等响应改为组合它们；
  `MessageRole` 移至 `constants.ts`（`MESSAGE_ROLES`）；`AppConfigPatch` 更名 `AppConfigPatchInput`，
  并补齐 `SessionIdInput` / `MessageListInput`。
- 数据库查询改用显式列清单（不再 `SELECT *`）；索引 `idx_session_updated` 更名 `idx_session_updated_at` 对齐命名规范。
- 根 `pnpm check` 增加约定校验一步（`node scripts/verify/index.ts`），并新增 `pnpm verify` 单独入口。
- `biome.json` 取消全部路径排除（`files.includes: ["**"]`）：打开 `css.parser.tailwindDirectives`
  让 Tailwind v4 入口 `index.css` 纳入检查；`apps/web/index.html` 的防闪内联脚本改为顶层
  `try` / `catch {}`，不再触发现代 JS 规则；`components/ui` 视为项目自有代码，一并纳入格式化与 lint。
- `scripts/verify` 的 tokens 检查纳入 `apps/web/src/components/ui`，并收紧裸色值判定：
  只认后面直接跟数值的颜色函数，允许 `color-mix(in oklch, var(--a), var(--b))` 这类对语义变量的合成。
- `config/update` 的 provider 条目放宽：`baseUrl` 与 `models` 变为可选——缺省表示沿用 pi 内置目录的同名
  供应商（端点与模型清单都由 pi 提供）。非内置 provider 仍必须同时给出两者，否则返回 400 且不落盘。
- 环境变量提供的凭证现在也会被识别为已接入（`available: true`、`authSource: "environment"`）：
  此前「刷新鉴权快照」从未执行，环境变量实际不生效。服务端存在 `DEEPSEEK_API_KEY` 这类变量时，
  即使 `config.json` 里没有任何 provider，状态也是已配置并回落到该供应商的首个模型。
- `API_TYPES` 从 4 个扩到 pi `KnownApi` 全集（补 `mistral-conversations` / `azure-openai-responses` /
  `openai-codex-responses` / `bedrock-converse-stream` / `google-vertex` / `pi-messages`），
  否则内置目录里部分供应商的 api 无法落盘。
- `MessageDTO` 为 assistant 消息补充 `provider` 与 `thinkingLevel`（产生该回复的 provider 与当时生效的推理档位，
  由会话条目里的 `model_change` / `thinking_level_change` 逐条推进）；对话历史底部展示为
  「provider/model · 推理档位 · 时间」，关闭推理时不显示档位。
- `CatalogModel` 新增 `vision`（是否接受图片输入）；聊天区的模型选择器对支持图片输入的模型展示「视觉」标签。
- `$APP_HOME/agent/` 下新增 `agents/` 目录（自定义子角色），目录不存在时按「无自定义角色」处理，
  不预建；服务启动时不主动创建该目录。
- 技能目录读取放行：模型按技能说明读 `SKILL.md`（及其相对引用文件）落在会话工作目录之外时，
  不再被 `external_directory` 判为越界审批；只读模式对 write / edit 的阻断更严，仍然生效
  （`permissions/defaults.ts` 的 `skillDirectoryRules`）。
- web 构建按 rolldown `output.codeSplitting` 分包：编辑器内核（Tiptap / ProseMirror）、
  Markdown 渲染链、UI 库、React 各成独立 chunk，主 chunk 由约 1.14MB 降到约 207KB，
  消除 vite 的体积告警并改善缓存。

### 修复

- 聊天区的模型选择器只列已接入的供应商：目录里还有 32 个未配凭证的内置供应商，
  选了必然报 `Provider is not configured`。
- 内置供应商被注册（写了 `baseUrl` 或 `models`）时，显示名不再从 pi 的 `DeepSeek` 退化成 id `deepseek`
  ——pi 的 `name` 取值里扩展层优先级最高，只在显式命名时才提交该字段。
- 带 `models` 的内置供应商不再因 `baseUrl` 为空而保存失败：空值不再提交（契约里它是可选的），
  内置卡片会提示「模型清单已被自定义」并提供「恢复默认」回到跟随 pi 的状态。
- 连通性测试改用表单里的 `baseUrl`：此前用的是加载时的快照，改完地址仍会测旧地址。
- `models/refresh` 与启动都会校验配置能否落地：refresh 返回 400 并说明原因，启动打一条告警但不阻断
  （此前手改 config.json 留下的坏条目被静默忽略，只在下次保存时才暴露）。
- 修复整体替换 providers 时 `defaultModel` 变成悬空引用：patch 未显式给出 `defaultModel` 时，
  若旧值指向的 provider 已被替换掉，清空并回落到「第一个可用模型」，避免保存成功但运行时不可用。
- 修复 `models/list` 的 `available` 恒为 `false`：`ModelRuntime.create({ refreshOnCreate: false })` 后从未刷新鉴权快照，
  `hasConfiguredAuth()` 一直是空集；改为按 provider 注入 apiKey 时会同步该 provider 的鉴权状态。
- 新会话发送首条消息后不再有「无加载反馈」的空窗：发送瞬间即进入 pending 态，
  消息区尾部立刻显示「思考中…」，直到首个生成事件或收尾、出错时消除。
- 首轮回答完成前刷新不再丢失会话：当前选中会话同步到 URL（`?session=`），刷新后据此恢复；
  在途草稿会话也会出现在列表里，`messages/list` 改读活跃会话的内存条目，对话区不再空白。
- 输入区发送后不再残留文本：Tiptap 编辑器不受控，此前清空草稿不会重置编辑器内容，
  导致「发出去的消息还在输入框里、再次回车会重复发送」；改为按草稿变化同步重置编辑器，
  且不会因打字触发重挂载（`composer.tsx`）。
- 历史里只有引用、没有正文的用户消息（单独发一个 `@`、或 `/skill:name` 不带参数）不再原样显示
  `<context>` / `<skill>` 展开块：chip 解析允许展开块位于消息末尾（`message-chips.ts`）。
- 草稿态 `/` 菜单改用真实工作目录取命令与技能：此前传的是展示名（如「助理区」），
  会从错误目录解析项目级资源（`composer.tsx`）。
- 切换会话时编辑器不再短暂沿用上一个会话的文档：外部填充记下所属 `editorKey`，
  仅在该键匹配时作为初始文档（`composer.tsx`）。
- 附件仍在上传时按发送会漏掉该附件、且上传完成后又回填进已清空的草稿：上传在途时禁用发送，
  并让 `submit` 以同步计数兜底（`use-composer-attachments.ts`、`composer.tsx`）。
- 非图片附件在历史里直接把内部引用行 `[附件: name (id: …)]` 显示给用户：改为还原成可下载的
  文件 chip，与发送瞬间的乐观视图一致（`message-chips.ts`、`message-item.tsx`）。
- `POST /attachments` 在读完整个请求体之后才判体积上限，超大上传会先被完整缓冲：改为先按
  `content-length` 拒绝，再在读完后兜底（`routes/attachments/index.ts`）。
- 附件过期清理的 DELETE 补上 `referenced_at IS NULL` 条件并只看真正删掉的行，避免与
  `markReferenced` 竞态时误删刚转永久的附件与其文件（`attachment-repository.ts`）。
- 附件转永久的时机改到会话装配成功之后：未配模型等装配失败时不再留下永不清理的永久附件
  （`run.ts`）。

### 移除

- 移除 `@ucode/ui` 的运行时注入单例（`src/runtime.ts` 的 `configureUi`）与 `lib` 的 api / sdk /
  event-stream 代理：改由 `UiProvider` 经 React context 下发应用层创建好的 `client`。
- 移除 `POST /sessions/delete`（由 `POST /sessions/archive` 取代）。
- 移除 `messages/prompt` 的 `cwd` 字段（会话级设置只在 `sessions/create`）。
- 移除 `SessionSummary.messageCount` 与 `SessionInfoResponse` 的 `persisted` / `entries` 字段。
- 移除 `SessionStateStore` 与池上的 `findInfo` / `listInfos`（原每次调用都 `SessionManager.listAll()` 全量扫描）；
  `sessions` 与 `messages` 路由改为直接读 `SessionRepository`，`messages/list` 按索引里的 `source_path` 打开 JSONL。
- 不再生成 `$APP_HOME/pi/models.json`：provider 目录与 apiKey 改为经 pi 的 `registerProvider` / `setRuntimeApiKey`
  注入内存，`$APP_HOME/app/config.json` 成为模型配置的唯一事实源，`pi/` 下不再出现明文凭证。
  升级后手工删掉遗留的 `pi/models.json` 即可（不会再被读取）。
- 移除未再引用的基础组件 `ui/card.tsx` 与 `ui/textarea.tsx`：空态改用纯排版，Composer 改为自绘输入卡
  （带边框的 `Textarea` / `Card` 与其内表面冲突，改用语义 token 直接拼装）。
- `useModels()` 不再返回 `loading`：调用处改用 `data` 是否为空表达加载态。

## [0.2.0] - 2026-09-29

### 新增

- 新增 `packages/contracts`（`@ucode/contracts`）：接口请求校验（zod）、响应类型、统一封套与跨端常量的单一事实源，
  server 与 web 共用同一入口（前端允许引到 zod，不再为隔离它拆子路径）。
- server 新增日志模块 `lib/logger`（pino，开发期 `pino-pretty`）与请求日志中间件 `requestLogger`。
- server 新增 `utils/`（纯函数）与 `constants.ts`（默认值与固定目录名）；新增 `APP_LOG_LEVEL` 环境变量。
- 引入 Biome 作为格式化与 lint 入口（`biome.json`），根脚本新增 `pnpm check`
  （`biome check .` + `pnpm -r typecheck`，作为强制校验入口）与 `pnpm format`。
- 添加 `AGENTS.md`：开发边界、提交流程、注释与编码约定、验证命令、目录约定、生成代码豁免与安全规则。
- 添加本文件。

### 变更

- server 目录：`pi/` 更名 `core/`；`lib/` 收敛为服务端基建（`response` / `validate` / `logger`），
  并与 `routes/` 一样要求一级使用文件夹；路由改为 `routes/<domain>/index.ts`。
- 环境变量统一 `APP_` 前缀：`PI_WORKSPACE_DIR` / `PI_AGENT_DIR` / `PI_DATA_DIR` 合并为主目录 `APP_HOME`
  （工作目录、配置与 `agent/` 全由它派生），`PORT` → `APP_PORT`、`POOL_IDLE_MS` → `APP_POOL_IDLE_MS`、
  `CORS_ORIGIN` → `APP_CORS_ORIGIN`。
- 接口出参统一为 `{ success, code, message, data }`：成功 `code: "ok"`，失败沿用字符串错误码并保留语义化
  HTTP 状态，错误详情放 `data`；请求参数一律进 body。
- `POST /api/v1/messages/send` 重命名为 `POST /api/v1/messages/prompt`。
- `health` 响应字段 `model` 改为 `defaultModel`，与其它接口保持一致。
- `config/info` / `config/update` 不再下发 provider 级 `headers`（可能含鉴权信息），与 `ProviderConfigView` 的声明对齐。
- web 的类型定义与接口封装改为引用 `@ucode/contracts`，删除本地重复定义；`sendMessageStream` 更名 `promptStream`。
- server 响应生产点补齐契约类型的显式标注 / `satisfies`，契约字段变更会直接编译失败（响应体不再停在推断状态）。
- 按 Biome 规则统一现有源码的排版与 import 顺序，清理未使用导入、非空断言与表达式内赋值；
  新增 `@biomejs/biome` 根开发依赖。

### 移除

- 移除 server 内重复的契约定义（`lib/schemas.ts`、`config/schema.ts`）与 `hono/logger`，日志统一走 pino。

## [0.1.0] - 2026-09-29

### 新增

- 初始化 pnpm workspace（`server/` + `apps/web/`），根脚本 `dev` / `build` / `start` / `typecheck` / `smoke`。
- `server/`：Hono + TypeScript，端口 2048，接口前缀 `/api/v1`（`health` 之外全 `POST`）——
  会话列表 / 详情 / 重命名 / 删除、历史、发送（SSE 流式，含 thinking 与 tool call 增量）、中断。
- `server/`：pi SDK 封装——`ModelRuntime` 单例与热重载、`AgentSession` 池（同会话串行 + 空闲回收）、
  复用 pi 的 JSONL 会话持久化；模型 / 端点 / API Key 走运行时配置而非 `.env`。
- `apps/web/`：Vite + React 19 + Tailwind v4 + shadcn/ui 对话界面（会话侧栏、消息流、工具调用卡片、
  模型设置），生产模式由 server 同源托管。
