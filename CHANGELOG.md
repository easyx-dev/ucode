# 变更日志

结构与归档规则见 `AGENTS.md` 的「变更日志（CHANGELOG）」章节。

## [未发布]

### 新增

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
  用 `PRAGMA user_version` 管理 schema；`session-repository` 保存会话元数据（name / cwd / model / thinkingLevel 覆盖值）
  与列表索引（名称、预览、条目数、消息数、创建/更新时间、JSONL 路径）。需 Node ≥ 24，启动会打印一条实验特性警告。
- `APP_HOME` 目录按「谁的资产」分两层：`pi/`（pi 私有：`models.json` / `auth.json` / `sessions/`）与
  `app/`（应用自有：`config.json` / `ucode.db`）；不再使用 `agent/` 与根目录的 `config.json`。
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

- `sessions/list` / `sessions/info` 改为读 SQLite 索引，不再每次 `SessionManager.listAll()` 全量扫描解析 JSONL；
  列表的过滤与排序下推到 SQL。启动时 `reconcile()` 以 JSONL 为准对齐索引，每轮生成落定后回写一次。
- 会话覆盖值从 `session-state.json` 迁到 SQLite（`config/session-state.ts` 移除），写入由整文件重写变为单行更新。
- 移除 `SessionStateStore` 与池上的 `findInfo` / `listInfos`（原每次调用都 `SessionManager.listAll()` 全量扫描）；
  `sessions` 与 `messages` 路由改为直接读 `SessionRepository`，`messages/list` 按索引里的 `source_path` 打开 JSONL。
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

### 移除

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
