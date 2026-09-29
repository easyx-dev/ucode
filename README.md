# ucode

把 [pi](https://pi.dev) 编码 agent（`@earendil-works/pi-coding-agent`）封装成 HTTP 服务，并配一个 Vite + React + shadcn/ui 的对话界面。

- **server/**：Hono + TypeScript，端口 `2048`，全部接口前缀 `/api/v1`（`health` 之外都是 `POST`）
- **apps/web/**：Vite + React 19 + Tailwind v4 + shadcn/ui，开发时跑 `5173`，生产由 server 同源托管
- **packages/contracts/**：`@ucode/contracts`，接口的请求校验与响应类型，server 与 web 共用同一份定义
- **packages/brand/**：`@ucode/brand`，品牌名与 logo / favicon 的单一来源，B 端定制只改这里
- 会话正文沿用 pi 的 JSONL；`$APP_HOME/app/app.db`（SQLite）保存应用自己的会话元数据与索引

项目规范：设计系统见 [`DESIGN.md`](./DESIGN.md)，数据库 / 接口 / 组件规范见 [`docs/`](./docs)；
仓库级约定与验证命令见 [`AGENTS.md`](./AGENTS.md)。

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

首次启动会提示「尚未配置模型」，点侧栏底部 **设置** 或调用 `POST /api/v1/config/update` 填入端点即可。

### 环境变量（`.env`）

`.env` 只放基础设施配置，**模型 / 端点 / API Key 不在这里**，而是通过接口写入 `$APP_HOME/app/config.json`：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_PORT` | `2048` | HTTP 端口 |
| `APP_HOME` | `~/.ucode` | 工作 / 配置主目录：agent 工作目录，以及 `pi/`、`app/` 两个数据子目录 |
| `APP_POOL_IDLE_MS` | `600000` | 内存中的 AgentSession 空闲多久后回收 |
| `APP_CORS_ORIGIN` | `*` | 开发模式跨域来源 |
| `APP_LOG_LEVEL` | 开发 `debug` / 生产 `info` | pino 日志级别 |

> `APP_HOME` 不设置时默认落在用户主目录（`~/.<品牌 slug>`，默认品牌即 `~/.ucode`）；
> 显式指定请用绝对路径，相对路径会按仓库根解析。

`APP_HOME` 派生出的路径（无需单独配置），按「谁的资产」分两层：

```
$APP_HOME/                 # 默认 ~/.ucode
├── pi/                    # pi 私有：models.json / auth.json / sessions/
└── app/                   # 应用自有：config.json / app.db（SQLite）
```

工作目录 = `$APP_HOME`、配置 = `$APP_HOME/app/config.json`、
pi 的 agent 目录 = `$APP_HOME/pi`（`models.json` / `auth.json` / `sessions/`）、
会话元数据与索引 = `$APP_HOME/app/app.db`。

> SQLite 用 Node 内置的 `node:sqlite`（`DatabaseSync`），需要 **Node ≥ 24**；它是实验特性，启动时会打印一条 `ExperimentalWarning`，不影响使用。

> agent 具备 `read` / `write` / `edit` / `bash` 工具，实际执行范围就是 `APP_HOME`，默认 `~/.ucode`。想让它改真实代码仓库，把它指向目标目录。

---

## 品牌定制

品牌名、浏览器标题与 logo / favicon 统一放在 `packages/brand/`（`@ucode/brand`），B 端交付只改这一处：

- `src/brand.ts`：`name`（侧栏、空态水印）、`title`（浏览器标题）、`slug`（主题存储键、默认数据目录等命名空间）
- `src/assets.ts`：`logoLight` / `logoDark` / `favicon` 三个图片引用，从 `assets/` 下的文件 import；
  换 logo 就替换文件，换格式就改这里的 import 扩展名（svg / png / jpg / webp … 都行）；
  只想要一套通用的 logo 时，把 `logoLight` / `logoDark` 指向同一个文件即可
- 标题与主题存储键由 `apps/web/plugins/brand-html.ts` 在构建时注入 `index.html`，避免首屏闪烁
- 默认数据目录名由 `slug` 派生（`~/.<slug>`，默认即 `~/.ucode`）

改完跑 `pnpm check`：其中的 brand 校验会检查品牌值合法、资源齐备，并拦下源码里残留的硬编码品牌名。历史遗留或不在品牌包覆盖范围内的文件，可用应急脚本批量矫正：

```bash
# 预演（默认不落盘）
node packages/brand/scripts/replace.ts --from 旧品牌 --to 新品牌
# 落盘；--paths 指定范围，--regex 让 --from 按正则解释
node packages/brand/scripts/replace.ts --from 旧品牌 --to 新品牌 --write
```

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
| POST | `/api/v1/messages/list` | `{ sessionId }` | 会话历史快照（compaction 感知，带接续用的 `seq`） |
| POST | `/api/v1/messages/prompt` | `{ sessionId, text, behavior? }` | 投递一轮生成，返回受理 ack；结果走 `/events` |
| POST | `/api/v1/messages/interrupt` | `{ sessionId }` | 中断当前生成 |
| POST | `/api/v1/events` | `{}` | 全局 SSE 事件流（所有会话的实时事件） |

### 全局事件流

生成与连接是解耦的：`messages/prompt` 只负责投递，事件统一从 `POST /api/v1/events` 推送。

```bash
curl -N -X POST http://localhost:2048/api/v1/events \
  -H 'content-type: application/json' -d '{}'
```

SSE 的事件名固定为 `message`，真正的类型在 `data` 的 JSON 里：

- 会话事件帧：`{ type, sessionId, seq, data }`，`type` 取自 `EVENT_NAMES`，`seq` 是会话内单调序号
- 控制帧：`{ type: "server.connected" }`、`{ type: "error", sessionId?, code, message }`
- 心跳为 `: heartbeat` 注释行（15s）

接续方式：先取 `messages/list` 快照（响应里的 `seq` 表示「已包含到该序号为止的全部效果」），
再连 `/events`，丢弃 `seq <= 快照 seq` 的帧。刷新或断线重连后重复这套流程即可，不会丢在途内容。

| 事件 `type` | data | 说明 |
| --- | --- | --- |
| `message_start` | `{ role }` | 新一轮消息开始 |
| `text_delta` | `{ delta }` | 正文增量 |
| `thinking_delta` | `{ delta }` | 思考增量 |
| `tool_call` | `{ toolCallId, toolName, args }` | 模型请求调用工具 |
| `tool_start` / `tool_update` / `tool_end` | `{ toolCallId, toolName, text?, isError? }` | 工具执行过程 |
| `message_end` | `MessageDTO` | 权威消息（前端用它替换流式内容） |
| `queue_update` | `{ steering, followUp }` | 生成中排队情况 |
| `compaction_start` / `compaction_end` | `{ reason? }` | 上下文压缩 |
| `session_info_changed` | `{ sessionId }` | 会话名 / 模型等元数据变化 |
| `agent_settled` | `{}` | 本次运行结束 |

`MessageDTO`：

```ts
{
  id: string
  role: "user" | "assistant" | "tool" | "custom" | "summary"
  blocks: Array<{ type: "text"; text } | { type: "thinking"; text } | { type: "toolCall"; id; name; args }>
  model?, toolCallId?, toolName?, isError?, createdAt?   // createdAt 为 ISO 8601 UTC
}
```

`toolCallId` 只在 `role: "tool"` 上出现，用于和 assistant 的 `toolCall.id` 对应（pi 默认并发执行工具调用，前端需要精确匹配而不是按顺序猜）。

### 生成中继续发消息

`messages/prompt` 默认不会占用「会话锁」（只有创建 `AgentSession` 那一步串行），所以并发请求是安全的：

- 会话空闲时 → 直接开启新一轮（`prompt`）。
- 会话正在生成时 → 按 `behavior` 投递：`"follow-up"`（默认）在当前这一轮（含工具调用）结束后处理；`"steer"` 在当前 assistant turn 的工具调用执行完之后、下一次 LLM 调用之前插入。投递后会先发 `queue_update` 事件，然后继续推流直到会话重新空闲。
- 极端竞态下（占用者刚结束）会退化成新的一轮；若连占位都拿不到，返回 `409 session_busy`。

---

## 结构

```
DESIGN.md                  # 设计系统（品牌 / 主题 / token / 深浅色）
docs/
  database.md              # 数据库规范
  api.md                   # 接口与字段规范
  components.md            # 组件规范
scripts/verify/            # 约定校验（migrations / contracts / tokens / brand），由 pnpm check 调用
packages/contracts/
  src/
    envelope.ts            # { success, code, message, data } 封套与错误码
    constants.ts           # API_VERSION / API_TYPES / THINKING_LEVELS / MESSAGE_ROLES
    common.ts              # emptyInputSchema、ListResult、SessionScoped
    runtime.ts             # RuntimeStatus
    events.ts              # 事件名与帧结构
    health/output.ts
    {models,sessions,messages,config}/{input,output}.ts
packages/brand/
  src/brand.ts             # 品牌唯一入口：name / title / slug（B 端定制只改这里）
  src/assets.ts            # logoLight / logoDark / favicon 的图片引用（换格式改这里的 import）
  assets/                  # logo-light.svg / logo-dark.svg / favicon.svg
  scripts/verify.ts        # 品牌校验（品牌值 / 图片引用 / 硬编码品牌名）
  scripts/replace.ts       # 应急：批量替换残留的旧品牌串
server/src/
  env.ts                   # APP_HOME 派生 pi/ 与 app/ 下的全部路径
  app.ts                   # Services 装配、配置热重载
  constants.ts             # 默认值与固定目录名
  utils/                   # 纯函数工具（time / object）
  lib/                     # 服务端基建
    response/              # 统一封套 + AppError
    validate/              # jsonBody 中间件
    logger/                # pino 实例 + 请求日志
  config/store.ts          # config.json 读写、apiKey 脱敏、生成 pi 的 models.json
  db/                      # SQLite（node:sqlite）
    index.ts               # 连接、PRAGMA、user_version 迁移
    session-repository.ts  # 会话元数据与索引的读写
  core/                    # pi SDK 封装
    runtime.ts             # ModelRuntime 单例、模型解析、模型目录
    pool.ts                # sessionId -> AgentSession 池、按会话串行、空闲回收
    event-bus.ts           # 会话事件总线（/events 的唯一数据源）
    run.ts                 # 后台推进一轮生成
    projection.ts          # 在途消息投影（刷新后不丢流式内容）
    session-index.ts       # pi 会话对象 -> 入库索引 / SessionInfo
    serialize.ts           # pi 会话条目 -> MessageDTO
    events.ts              # AgentSessionEvent -> SSE 事件
  routes/                  # health / models / config / sessions / messages / events
  index.ts                 # Hono 装配、静态托管 web、优雅退出
  scripts/smoke.ts         # 不经 HTTP 的 SDK 冒烟测试
apps/web/src/
  lib/                     # 接口封装、契约类型出口、SSE 与事件流、消息归并、纯函数
  hooks/                   # 数据获取与订阅（use-chat / use-session-list / use-models …）
  components/
    ui/                    # 基础组件（shadcn 生成后归我们维护）
    <feature>/             # 业务组件，如 settings/
    *.tsx                  # 侧栏、消息列表、工具卡片、Composer、主题与分段控件
```

### 实现要点

- **会话持久化**：消息正文交给 pi 的 `SessionManager`，落在 `$APP_HOME/pi/sessions/*.jsonl`；应用自己的会话元数据与列表索引（覆盖值、名称、预览、计数、时间、文件路径）放 `$APP_HOME/app/app.db`。
- **索引同步**：启动时 `reconcile()` 以 JSONL 为准对齐索引（补齐外部新增、清理已删文件），每轮生成落定后再回写一次；列表 / 详情直接读 SQLite，不再扫描 JSONL 目录。
- **AgentSession 池**：同一会话串行执行（流式期间到达的消息会排队），空闲 `APP_POOL_IDLE_MS` 后 `dispose()`，下次访问从 JSONL 恢复。
- **配置热重载**：`config/update` 会先校验并落盘，再重建 `ModelRuntime`、丢弃内存会话（校验失败不会动内存会话）；有会话正在生成时返回 `409 session_busy`。
- **未落盘的草稿会话**：pi 只在产生 assistant 回复后才写文件，所以新建会话的名字/模型先落在 SQLite 的草稿行（`persisted = 0`），首次回复后索引对齐。
- **schema 演进**：`db/index.ts` 用 `PRAGMA user_version` 记录版本，新增迁移时递增 `SCHEMA_VERSION` 并补一条 DDL；开发初期允许破坏性变更，删本地 `app.db` 重建即可。
- **删除会话**：先停用运行中的资源（`pool.dispose` / `events.remove`），再删 SQLite 行，最后删 JSONL 文件；顺序不能颠倒，见 `docs/database.md`。
- **主题**：`next-themes` + `.dark` class，浅色 / 深色 / 跟随系统三态；首屏由 `index.html` 的内联脚本定色以避免闪白。颜色与圆角全部走语义 token（`DESIGN.md`），`scripts/verify` 会拦下裸色值。

## 验证

```bash
pnpm check     # biome check . && pnpm -r typecheck && pnpm verify
pnpm verify    # 只跑约定校验（scripts/verify）
```

约定校验覆盖三项：SQLite 迁移版本必须从 1 起连续、契约字段必须 camelCase 且 `*Request` 有配对的 `*Input`、
业务组件不得出现裸色值或非语义颜色 utility。对应规范见 `docs/` 与 `DESIGN.md`。

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
