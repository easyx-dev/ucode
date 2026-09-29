# 变更日志

结构与归档规则见 `AGENTS.md` 的「变更日志（CHANGELOG）」章节。

## [未发布]

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
