# ucode

把 [pi](https://pi.dev) 编码 agent（`@earendil-works/pi-coding-agent`）封装成 HTTP 服务，并配一个 Vite + React + shadcn/ui 的对话界面。

- **server/**：Hono + TypeScript，端口 `2048`，全部接口前缀 `/api/v1`（`health` 之外都是 `POST`）
- **apps/web/**：Vite + React 19 + Tailwind v4 + shadcn/ui，开发时跑 `5173`，生产由 server 同源托管
- **packages/contracts/**：`@ucode/contracts`，接口的请求校验与响应类型，server 与 web 共用同一份定义
- 会话正文沿用 pi 的 JSONL；`$APP_HOME/app/ucode.db`（SQLite）保存应用自己的会话元数据与索引

---

## 快速开始

```bash
pnpm install

# 开发：server(2048) + web(5173) 一起启动
pnpm dev

# 生产：构建 web 后只用 2048 一个端口
pnpm build && pnpm start
```

打开 `http://localhost:2048`（生产）或 `http://localhost:5173`（开发）。

首次启动会提示「尚未配置模型」，点侧栏底部 **模型设置** 或调用 `POST /api/v1/config/update` 填入端点即可。

### 环境变量（`.env`）

`.env` 只放基础设施配置，**模型 / 端点 / API Key 不在这里**，而是通过接口写入 `.tmp/.ucode/app/config.json`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `2048` | HTTP 端口 |
| `APP_HOME` | `.tmp/.ucode` | 工作 / 配置主目录：agent 工作目录，以及 `pi/`、`app/` 两个数据子目录 |
| `APP_POOL_IDLE_MS` | `600000` | 内存中的 AgentSession 空闲多久后回收 |
| `APP_CORS_ORIGIN` | `*` | 开发模式跨域来源 |
| `APP_LOG_LEVEL` | 开发 `debug` / 生产 `info` | pino 日志级别 |

`APP_HOME` 派生出的路径（无需单独配置），按「谁的资产」分两层：

```
$APP_HOME/                 # 默认 .tmp/.ucode
├── pi/                    # pi 私有：models.json / auth.json / sessions/
└── app/                   # 应用自有：config.json / ucode.db（SQLite）
```

工作目录 = `$APP_HOME`、配置 = `$APP_HOME/app/config.json`、
pi 的 agent 目录 = `$APP_HOME/pi`（`models.json` / `auth.json` / `sessions/`）、
会话元数据与索引 = `$APP_HOME/app/ucode.db`。

> SQLite 用 Node 内置的 `node:sqlite`（`DatabaseSync`），需要 **Node ≥ 24**；它是实验特性，启动时会打印一条 `ExperimentalWarning`，不影响使用。

> agent 具备 `read` / `write` / `edit` / `bash` 工具，实际执行范围就是 `APP_HOME`，默认 `.tmp/.ucode`（已在 `.gitignore` 里）。想让它改真实代码仓库，把它指向目标目录。

---

## 模型配置

配置持久化在 `$APP_HOME/app/config.json`，通过接口或界面管理，保存后自动重建 pi 的 `ModelRuntime`（内存中的会话会被丢弃，历史文件不受影响）。

### 本项目开发时用的测试端点

| 项 | 值 |
| --- | --- |
| baseUrl | `http://localhost:8317/v1` |
| api | `openai-completions` |
| apiKey | `devtest` |
| 可用模型 | `deepseek-v4-flash`（推荐）、`deepseek-v4-pro`、`glm-5.2`、`kimi` |

已实测该端点支持：SSE 流式、`tool_calls`、`reasoning_content`、`reasoning_effort`。

**注意**：这个网关不接受 `role: "developer"`（部分自建/代理网关的常见限制），
所以服务在生成 pi 的 `models.json` 时默认给每个模型补上
`"compat": { "supportsDeveloperRole": false }`，让 pi 改用 `system` role。
如果换成官方 OpenAI 端点且想用 `developer`，在设置里把该模型的 `compat` 覆盖掉即可。

### 直接调用接口配置

```bash
curl -X POST http://localhost:2048/api/v1/config/update \
  -H 'content-type: application/json' \
  -d '{
    "providers": [{
      "id": "local",
      "name": "Local Gateway",
      "baseUrl": "http://localhost:8317/v1",
      "api": "openai-completions",
      "apiKey": "devtest",
      "models": [
        { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "reasoning": true },
        { "id": "glm-5.2", "name": "GLM 5.2", "reasoning": true }
      ]
    }],
    "defaultModel": "local/deepseek-v4-flash",
    "thinkingLevel": "medium"
  }'
```

想先确认端点通不通：

```bash
curl -X POST http://localhost:2048/api/v1/config/test \
  -H 'content-type: application/json' \
  -d '{"baseUrl":"http://localhost:8317/v1","apiKey":"devtest","model":"deepseek-v4-flash"}'
```

模型字段（对应 pi 的 `ProviderModelConfig`）：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `id` | 必填 | 模型 id |
| `name` | = `id` | 显示名 |
| `reasoning` | `false` | 是否支持思考，配合 `thinkingLevel` |
| `input` | `["text"]` | 支持的输入类型 |
| `contextWindow` | `128000` | 上下文窗口 |
| `maxTokens` | `8192` | 最大输出 |
| `cost` | 全 0 | 成本统计用 |
| `compat` | `{ supportsDeveloperRole: false }` | pi 的 `OpenAICompletionsCompat`，透传 |

---

## HTTP 接口

统一响应体：`{ "success": true, "code": "ok", "message": "", "data": ... }`；
失败为 `{ "success": false, "code": "invalid_request", "message": "...", "data": <详情> }`（HTTP 状态仍保留语义，如 400 / 404 / 409）。
除 `GET /api/v1/health` 外，所有接口都是 `POST` + JSON body，参数一律放在 body、不出现在路径里。
请求校验与响应结构定义在 `@ucode/contracts`（`packages/contracts/`），web 直接引用同一份类型。

| 方法 | 路径 | body | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | — | 存活 + `configured` / 当前模型 |
| POST | `/api/v1/models/list` | `{}` | 模型目录（含 provider 凭证状态） |
| POST | `/api/v1/models/refresh` | `{}` | 丢弃内存会话、按当前配置重建运行时 |
| POST | `/api/v1/config/info` | `{}` | 当前配置（apiKey 脱敏） |
| POST | `/api/v1/config/update` | `{ providers?, defaultModel?, thinkingLevel? }` | 更新配置并热重载；provider 的 `apiKey` 留空表示沿用已保存的 |
| POST | `/api/v1/config/test` | `{ baseUrl, apiKey?, providerId?, api?, model }` | 连通性测试 |
| POST | `/api/v1/sessions/list` | `{ q?, limit? }` | 会话列表（含每个会话生效的 `model` / `thinkingLevel`） |
| POST | `/api/v1/sessions/create` | `{ name?, cwd?, model?, thinkingLevel? }` | 新建会话（返回 id；首次回复后才落盘） |
| POST | `/api/v1/sessions/info` | `{ sessionId }` | 会话详情 |
| POST | `/api/v1/sessions/update` | `{ sessionId, name?, model?, thinkingLevel? }` | 重命名 / 换模型 |
| POST | `/api/v1/sessions/delete` | `{ sessionId }` | 删除会话（含会话文件） |
| POST | `/api/v1/messages/list` | `{ sessionId }` | 会话历史（compaction 感知） |
| POST | `/api/v1/messages/prompt` | `{ sessionId, text, behavior? }` | 发起生成，返回 `text/event-stream` |
| POST | `/api/v1/messages/interrupt` | `{ sessionId }` | 中断当前生成 |

### 发起生成（SSE）

```bash
curl -N -X POST http://localhost:2048/api/v1/messages/prompt \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<uuid>","text":"列一下当前目录"}'
```

事件（`event:` / `data:` JSON）：

| 事件 | data | 说明 |
| --- | --- | --- |
| `message_start` | `{ role }` | 新一轮消息开始 |
| `text_delta` | `{ delta }` | 正文增量 |
| `thinking_delta` | `{ delta }` | 思考增量 |
| `tool_call` | `{ toolCallId, toolName, args }` | 模型请求调用工具 |
| `tool_start` / `tool_update` / `tool_end` | `{ toolCallId, toolName, text?, isError? }` | 工具执行过程 |
| `message_end` | `MessageDTO` | 权威消息（前端用它替换流式内容） |
| `queue_update` | `{ steering, followUp }` | 生成中排队情况 |
| `compaction_start` / `compaction_end` | `{ reason? }` | 上下文压缩 |
| `agent_settled` / `done` | `{}` | 本次运行结束 |
| `error` | `{ code, message }` | 出错 |

`MessageDTO`：

```ts
{
  id: string
  role: "user" | "assistant" | "tool" | "custom" | "summary"
  blocks: Array<{ type: "text"; text } | { type: "thinking"; text } | { type: "toolCall"; id; name; args }>
  model?, toolCallId?, toolName?, isError?, timestamp?
}
```

`toolCallId` 只在 `role: "tool"` 上出现，用于和 assistant 的 `toolCall.id` 对应（pi 默认并发执行工具调用，前端需要精确匹配而不是按顺序猜）。

### 生成中继续发消息

`messages/prompt` 默认不会占用「会话锁」（只有创建 `AgentSession` 那一步串行），所以并发请求是安全的：

- 会话空闲时 → 直接开启新一轮（`prompt`）。
- 会话正在生成时 → 按 `behavior` 投递：`"follow-up"`（默认）在当前这一轮（含工具调用）结束后处理；`"steer"` 在当前 assistant turn 的工具调用执行完之后、下一次 LLM 调用之前插入。投递后会先发 `queued` 事件，然后继续推流直到会话重新空闲。
- 极端竞态下（占用者刚结束）会退化成新的一轮；若连占位都拿不到，返回 `409 session_busy`。

---

## 结构

```
packages/contracts/
  src/
    envelope.ts            # { success, code, message, data } 封套与错误码
    constants.ts           # API_TYPES / THINKING_LEVELS / API 前缀
    runtime.ts             # RuntimeStatus
    {health,models}/{input,output}.ts
    {config,sessions,messages}/{input,output}.ts
server/src/
  env.ts                   # APP_HOME 派生 pi/ 与 app/ 下的全部路径
  app.ts                   # Services 装配、配置热重载
  constants.ts             # 默认值与固定目录名
  utils/                   # 纯函数工具（time / object）
  lib/                     # 服务端基建
    response/              # 统一封套 + AppError
    validate/              # jsonBody 中间件
    logger/                # pino 实例 + 请求日志
  config/
    store.ts               # config.json 读写、apiKey 脱敏、生成 pi 的 models.json
  db/                      # SQLite（node:sqlite）
    index.ts               # 连接、PRAGMA、user_version 迁移
    session-repository.ts  # 会话元数据与索引的读写
  core/                    # pi SDK 封装
    runtime.ts             # ModelRuntime 单例、模型解析、模型目录
    pool.ts                # sessionId -> AgentSession 池、按会话串行、空闲回收
    session-index.ts       # pi 会话对象 -> 入库索引 / SessionInfo
    serialize.ts           # pi 会话条目 -> MessageDTO
    events.ts              # AgentSessionEvent -> SSE 事件
  routes/                  # health / models / config / sessions / messages（一级均为文件夹）
  index.ts                 # Hono 装配、静态托管 web、优雅退出
  scripts/smoke.ts         # 不经 HTTP 的 SDK 冒烟测试
apps/web/src/
  lib/{api,types,sse}.ts   # 接口封装、类型（引用 @ucode/contracts）、SSE 解析
  hooks/{use-sessions,use-chat,use-models}.ts
  components/              # 侧栏、消息列表、工具卡片、输入框、设置对话框
```

### 实现要点

- **会话持久化**：消息正文交给 pi 的 `SessionManager`，落在 `$APP_HOME/pi/sessions/*.jsonl`；应用自己的会话元数据与列表索引（覆盖值、名称、预览、计数、时间、文件路径）放 `$APP_HOME/app/ucode.db`。
- **索引同步**：启动时 `reconcile()` 以 JSONL 为准对齐索引（补齐外部新增、清理已删文件），每轮生成落定后再回写一次；列表 / 详情直接读 SQLite，不再扫描 JSONL 目录。
- **AgentSession 池**：同一会话串行执行（流式期间到达的消息会排队），空闲 `APP_POOL_IDLE_MS` 后 `dispose()`，下次访问从 JSONL 恢复。
- **配置热重载**：`config/update` 会先校验并落盘，再重建 `ModelRuntime`、丢弃内存会话（校验失败不会动内存会话）；有会话正在生成时返回 `409 session_busy`。
- **未落盘的草稿会话**：pi 只在产生 assistant 回复后才写文件，所以新建会话的名字/模型先落在 SQLite 的草稿行（`persisted = 0`），首次回复后索引对齐。
- **schema 演进**：`db/index.ts` 用 `PRAGMA user_version` 记录版本，新增迁移时递增 `SCHEMA_VERSION` 并补一条 DDL。

## 冒烟测试

不走 HTTP，直接用 pi SDK 验证「端点 + 模型 + 工具 + 流式」：

```bash
pnpm smoke
# 或指定参数
pnpm -F @ucode/server smoke -- --base-url http://localhost:8317/v1 --api-key devtest --model glm-5.2
```

## 常见问题

- **`configured: false`**：还没配 provider，或 `defaultModel` 指向了不存在的 `provider/model`；看 `health` 返回的 `error`。
- **模型列表为空**：`models/list` 只列出配置里有凭证的 provider，检查 `baseUrl` / `apiKey`。
- **`sessionId` 报 400**：id 只接受 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（与 pi 的会话 id 规则一致），新建会话用返回的 UUID。
- **调用上游报 400 `invalid_request`**：多为网关兼容性差异。先用 `config/test` 二分定位，必要时通过模型的 `compat` 关掉 `supportsDeveloperRole`、`supportsStore`、`supportsReasoningEffort` 等开关。
- **端口被占用**：改 `.env` 的 `APP_PORT`，同时改 `apps/web/vite.config.ts` 里的代理目标。
- **⚠️ 安全**：当前版本没有 HTTP 鉴权、默认监听所有网卡，且背后的 agent 有 `bash` 权限。**不要把它暴露到公网或不可信网络**。待办与整改方案见 [`TODO.md`](./TODO.md)。
