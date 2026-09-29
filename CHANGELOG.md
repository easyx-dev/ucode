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

### 变更

- `POST /api/v1/messages/prompt` 改为投递语义：返回 `{ sessionId, admitted }` 回执，生成在服务端后台继续，
  事件统一走 `/events`（原请求级 SSE 流移除）。
- server `core/` 新增 `event-bus.ts`（会话事件总线，`AgentSession` 入池即常驻订阅）、`projection.ts`
  （在途投影）与 `run.ts`（后台运行），移除 `run-stream.ts`。
- web 的 `hooks/use-session-history.ts` 由 `use-session-stream.ts` 取代；`use-send-message` 不再消费 SSE。

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
