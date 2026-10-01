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

### 变更

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

### 移除

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
