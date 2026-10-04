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
| `APP_HOME` | `~/.ucode` | 配置 / 数据主目录：`agent/`、`app/`、`workspace/` 三个子目录 |
| `APP_POOL_IDLE_MS` | `600000` | 内存中的 AgentSession 空闲多久后回收 |
| `APP_CORS_ORIGIN` | `*` | 开发模式跨域来源 |
| `APP_LOG_LEVEL` | 开发 `debug` / 生产 `info` | pino 日志级别 |
| `APP_PROMPT_SOURCE` | `custom` | 系统提示词源：`custom`（整段自研）/ `pi`（pi 默认 + 自研片段），改后重启生效 |

> `APP_HOME` 不设置时默认落在用户主目录（`~/.<品牌 slug>`，默认品牌即 `~/.ucode`）；
> 显式指定请用绝对路径，相对路径会按仓库根解析。

`APP_HOME` 派生出的路径（无需单独配置），按「谁的资产」分两层：

```
$APP_HOME/                 # 默认 ~/.ucode
├── agent/                 # agent 私有：auth.json / sessions/
├── app/                   # 应用自有：config.json / app.db（SQLite）
└── workspace/<sessionId>  # 未绑定目录的会话的工作目录
```

配置 = `$APP_HOME/app/config.json`、agent 目录 = `$APP_HOME/agent`（`auth.json` / `sessions/`）、
会话元数据与索引 = `$APP_HOME/app/app.db`。
会话的工作目录：绑定目录的用那个目录，未绑定的用 `$APP_HOME/workspace/<sessionId>`。

> SQLite 用 Node 内置的 `node:sqlite`（`DatabaseSync`），需要 **Node ≥ 24**；它是实验特性，启动时会打印一条 `ExperimentalWarning`，不影响使用。

> agent 具备 `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls` 工具与自研的
> `webfetch` / `websearch`，实际执行范围就是 `APP_HOME`，默认 `~/.ucode`。想让它改真实代码仓库，把它指向目标目录。

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

### 接入 pi 内置供应商（推荐）

pi 自带一份供应商目录（`pi-ai` 的 `providers/all`）。设置页的「接入内置供应商」会列出其中
**可用一把 API key 直接接入**的那些（32 个：deepseek / minimax / zai / kimi-coding / xiaomi / qwen-token-plan /
openai / anthropic / xai / openrouter / google / groq / mistral / together …），选中后只需填 apiKey。

这类条目在 `config.json` 里**只记 `id` 与 `apiKey`**，端点与模型清单都由 pi 提供：

```jsonc
{ "providers": [ { "id": "deepseek", "api": "openai-completions", "apiKey": "sk-..." } ] }
```

好处是 pi 升级（新增模型、调整上下文窗口）会自动生效，不用重配。

以下两类不在此列，需要显式配置：端点为 null（随凭证解析，如 `amazon-bedrock` / `google-vertex` /
`cloudflare-*` / `azure-openai-responses` / `opencode`）与只有 OAuth 的（`openai-codex`）。
它们的凭证也可以直接来自环境变量（如 `DEEPSEEK_API_KEY`），此时目录里会显示为已接入。

### 自定义供应商

pi 不认识的端点用「添加自定义供应商」，必须同时给出 `baseUrl` 与 `models`：

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

自定义供应商也可以给 `models` 覆盖内置供应商的模型清单——**一旦给出即为整体替换**（不是按 id 合并），
此后该供应商不再跟随 pi 内置目录更新。

### 本项目开发时用的测试端点

| 项 | 值 |
| --- | --- |
| baseUrl | `http://localhost:8317/v1` |
| api | `openai-completions` |
| apiKey | `devtest` |
| 可用模型 | `deepseek-v4-flash`（推荐）、`deepseek-v4-pro`、`glm-5.2`、`kimi` |

已实测该端点支持：SSE 流式、`tool_calls`、`reasoning_content`、`reasoning_effort`。

**注意**：这个网关不接受 `role: "developer"`（部分自建/代理网关的常见限制），
所以服务把 provider 与模型注入 pi 的 `ModelRuntime` 时，默认给每个模型补上
`"compat": { "supportsDeveloperRole": false }`，让 pi 改用 `system` role。
如果换成官方 OpenAI 端点且想用 `developer`，在设置里把该模型的 `compat` 覆盖掉即可。

### 连通性测试

```bash
curl -X POST http://localhost:2048/api/v1/config/test \
  -H 'content-type: application/json' \
  -d '{"baseUrl":"http://localhost:8317/v1","apiKey":"devtest","model":"deepseek-v4-flash"}'
```

（只支持 `openai-completions`。）

### 模型字段（对应 pi 的 `Model`）

`provider.models[]` 的常用字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `id` | 必填 | 模型 id |
| `name` | = `id` | 显示名 |
| `api` | provider 级值 | 覆盖该模型的 API 格式 |
| `baseUrl` | provider 级值 | 覆盖该模型的端点 |
| `reasoning` | `false` | 是否支持思考，配合 `thinkingLevel` |
| `thinkingLevelMap` | 厂商默认 | pi 的 7 档 `off`…`max` → 厂商取值；`null` 表示该档不支持 |
| `input` | `["text"]` | 支持的输入类型（`text` / `image`） |
| `inputLimits` | 无 | 请求体积上限与图片缩放 / 每消息 / 每请求上限 |
| `contextWindow` | `128000` | 上下文窗口 |
| `maxTokens` | `8192` | 最大输出 |
| `cost` | 全 0 | 计价；`tiers` 支持按输入 token 分档 |
| `promptCache` | 无 | 提示缓存时长（`short` / `long`） |
| `samplingParams` | 无 | 该模型的默认采样参数，单次请求可覆盖 |
| `headers` | 无 | 该模型的请求头 |
| `compat` | `{ supportsDeveloperRole: false }` | pi 的 `*Compat` 开关，按 `api` 收窄，原样透传 |

`thinkingLevel` 取值与 pi 一致：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`。

---

## 联网搜索

agent 有自研的 `webfetch`（抓链接转 markdown）与 `websearch`（联网搜索，只给标题 / 链接 / 摘要）两个工具。
`websearch` 需要一家搜索服务商，配置与模型同放 `$APP_HOME/app/config.json`，
也可以在设置对话框的「联网搜索」区块里改。

| provider | 门槛 | 鉴权 / 地址 |
| --- | --- | --- |
| `tavily`（默认） | 注册即用，免费档 1000 次/月、**不用绑卡** | `Authorization: Bearer tvly-…` |
| `searxng` | **完全免费、无需注册**，但要自己跑一个实例 | `baseUrl`，如 `http://localhost:8888` |
| `brave` | 2026-02 起新人只剩 $5/月赠金，**要绑卡** | `X-Subscription-Token` |

三家都需要在 `config.json` 里配：key 型填 `apiKey`，自建实例填 `baseUrl`。

```jsonc
{ "websearch": { "provider": "tavily", "apiKey": "tvly-..." } }
```

```bash
curl -X POST http://localhost:2048/api/v1/config/update \
  -H 'content-type: application/json' \
  -d '{"websearch":{"provider":"tavily","apiKey":"tvly-..."}}'
```

**自建 SearXNG**（无 key、无额度限制、查询不出本机）。注意它**默认只开 HTML 输出**，
而 `websearch` 走的是 JSON 接口，所以要挂一份开了 `json` 的 `settings.yml` 进去：

```bash
mkdir -p searxng
cat > searxng/settings.yml <<'YAML'
use_default_settings: true
server:
  secret_key: "换成你自己的随机串"
search:
  formats:
    - html
    - json
YAML
docker run -d --name searxng -p 8888:8080 -v "$PWD/searxng:/etc/searxng" searxng/searxng:latest
```

验证（`200` 表示 JSON 已开，`403` 说明 `search.formats` 里还没有 `json`）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8888/search?q=test&format=json'
```

然后把设置页的「搜索服务商」选成 SearXNG、实例地址填 `http://localhost:8888` 即可（地址必须带 `http://` 或 `https://`）。

- `apiKey` 留空表示沿用已保存的 key；没配好前置条件时 `websearch` 不会崩，只返回一条可读错误。
- `webfetch` 不需要任何配置，但只抓公网地址：回环、私网与链路本地（含云元数据 `169.254.169.254`）一律拒绝，
  重定向逐跳校验；正文最多 5MB，交给模型的正文再按 50KB 截断。
- 抓到的内容以 `<fetched>` / `<search_results>` 包起来，提示模型那是外部数据而非指令。

---

## HTTP 接口

统一响应体：`{ "success": true, "code": "ok", "message": "", "data": ... }`；
失败为 `{ "success": false, "code": "invalid_request", "message": "...", "data": <详情> }`（HTTP 状态仍保留语义，如 400 / 404 / 409）。
除 `GET /api/v1/health` 外，所有接口都是 `POST` + JSON body，参数一律放在 body、不出现在路径里。
请求校验与响应结构定义在 `@ucode/contracts`（`packages/contracts/`），web 直接引用同一份类型。
失败响应带 `code` + 中文兜底 `message` + 插值 `params`，客户端按 `code` 渲染当前语言（见 `docs/api.md`「语言与本地化」）。

逐个接口的**请求参数与响应结构**见自动生成的 [`docs/api-reference.md`](docs/api-reference.md)
（由 `pnpm api:docs` 从 `packages/contracts/` 生成，`pnpm check` 校验其与契约一致）。

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
  api-reference.md         # 接口参考（由 pnpm api:docs 生成，勿手改）
  components.md            # 组件规范
scripts/api-docs/          # 接口参考生成器（endpoints 清单 + 生成 + 校验）
scripts/verify/            # 约定校验（migrations / contracts / api-docs / tokens / brand / i18n），由 pnpm check 调用
packages/contracts/
  src/
    envelope.ts            # { success, code, message, data } 封套与错误码
    constants.ts           # API_VERSION / API_TYPES / THINKING_LEVELS / MESSAGE_ROLES
    locale.ts              # LOCALES / Locale / DEFAULT_LOCALE / isLocale
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
packages/i18n/             # 跨端 i18n 运行时与共享文案（只依赖 i18next）
  src/index.ts             # createI18n / 共享目录，不导出全局单例
  src/config.ts            # house i18next 配置（key 即文案，无 key / ns 分隔符）
  src/error-messages.ts    # ERROR_CODES → 文案 key（客户端按 code 渲染错误）
  src/locales/common/      # 协议级通用文案（中英）
  src/locales/domain/      # 错误码文案（中英）
  src/locales/ui/          # 产品界面文案（web / Electron / TUI 共用，中英）
server/src/
  env.ts                   # APP_HOME 派生 pi/ 与 app/ 下的全部路径
  app.ts                   # Services 装配、配置热重载
  constants.ts             # 默认值与固定目录名
  utils/                   # 纯函数工具（time / object）
  lib/                     # 服务端基建
    response/              # 统一封套 + AppError（message 为中文兜底，params 给客户端插值）
    validate/              # jsonBody 中间件
    logger/                # pino 实例 + 请求日志
  config/store.ts          # config.json 读写、apiKey 脱敏
  db/                      # SQLite（node:sqlite）
    index.ts               # 连接、PRAGMA、user_version 迁移
    session-repository.ts  # 会话元数据与索引的读写
  core/                    # pi SDK 封装
    runtime.ts             # ModelRuntime 单例、模型解析、模型目录
    provider-config.ts     # provider 配置 → pi registerProvider 入参
    pool.ts                # sessionId -> AgentSession 池、按会话串行、空闲回收
    event-bus.ts           # 会话事件总线（/events 的唯一数据源）
    run.ts                 # 后台推进一轮生成
    projection.ts          # 在途消息投影（刷新后不丢流式内容）
    session-index.ts       # pi 会话对象 -> 入库索引 / SessionInfo
    serialize.ts           # pi 会话条目 -> MessageDTO
    events.ts              # AgentSessionEvent -> SSE 事件
  agent/                   # 会话装配层：覆盖值 + 运行时 -> createAgentSession 参数
    session-config.ts      # 工作目录 / 模型 / 档位解析与创建参数组装（模式/工具/提示词的汇入点）
    prompt/                # 系统提示词：组装 + 多语言目录 + 模型族变体（pi / custom 两套源可切换）
      index.ts             # 按目录拼装整段提示词（custom 源）或 pi 源叠加片段
      locales/             # 语言目录：新增语言＝按 PromptCatalog 加文件并注册（当前仅 zh-CN）
      variant.ts           # 模型适配：按模型解析提示词变体（当前统一 default）
    tools/                 # 自研工具与工具集装配
      index.ts             # 内置工具白名单 + 自研工具的成对装配（交给 createAgentSession）
      webfetch.ts          # 抓公网链接转 markdown（响应体上限、返回内容边界包裹）
      ssrf.ts              # 目标准入：协议白名单 + 回环 / 私网 / 链路本地拦截
      websearch/           # 搜索 provider 抽象（brave / tavily）与 index.ts 工具定义
    __tests__/             # 同模块的单元测试（约定见 AGENTS.md）
  routes/                  # health / models / config / sessions / messages / events
  index.ts                 # Hono 装配、静态托管 web、优雅退出
  scripts/
    smoke.ts               # 不经 HTTP 的 SDK 冒烟测试
    eval.ts                # 提示词评测：真实模型跑固定用例，按提示词源对比
    lib/local-gateway.ts   # smoke / eval 共用的本地端点装配
apps/web/src/
  lib/                     # 接口封装、契约类型出口、SSE 与事件流、消息归并、纯函数
    i18n.ts                # i18next 接线与语言切换（文案在 @ucode/i18n）
  hooks/                   # 数据获取与订阅（use-chat / use-session-list / use-models …）
  components/
    ui/                    # 基础组件（shadcn 生成后归我们维护）
    <feature>/             # 业务组件，如 settings/
    *.tsx                  # 侧栏、消息列表、工具卡片、Composer、主题与分段控件
```

### 实现要点

- **会话持久化**：消息正文交给 pi 的 `SessionManager`，落在 `$APP_HOME/agent/sessions/*.jsonl`；应用自己的会话元数据与列表索引（覆盖值、名称、预览、计数、时间、文件路径）放 `$APP_HOME/app/app.db`。
- **索引同步**：启动时 `reconcile()` 以 JSONL 为准对齐索引（补齐外部新增、清理已删文件），每轮生成落定后再回写一次；列表 / 详情直接读 SQLite，不再扫描 JSONL 目录。
- **AgentSession 池**：同一会话串行执行（流式期间到达的消息会排队），空闲 `APP_POOL_IDLE_MS` 后 `dispose()`，下次访问从 JSONL 恢复。
- **配置热重载**：`config/update` 会先校验并落盘，再重建 `ModelRuntime`、丢弃内存会话（校验失败不会动内存会话）；有会话正在生成时返回 `409 session_busy`。
- **模型注入不落盘**：provider 目录与 apiKey 通过 pi 的 `registerProvider` / `setRuntimeApiKey` 注入内存，不生成 `agent/models.json`；`config.json` 是模型配置的唯一事实源。
- **工具集在装配层收口**：内置工具走 `tools` 白名单（pi 的该字段是白名单，自研工具漏进去就会被过滤掉），
  `webfetch` / `websearch` 走 `customTools`；`grep` / `find` / `ls` 直接用 pi 内置实现，不自己写。
  **本服务只启用这份固定工具集**：pi 扩展（`$APP_HOME/agent/extensions`、项目 `.pi/extensions`）或 pi 包
  注册的工具不在白名单里，不会生效。
- **外部内容不入信任链**：`webfetch` 只抓公网地址（回环 / 私网 / 链路本地一律拒绝，重定向逐跳校验），
  并用 `<fetched>` / `<search_results>` 边界包裹返回内容，正文里的同名标签先中和（否则页面能「闭合」边界），
  工具说明里声明「那是数据不是指令」。
- **未落盘的草稿会话**：pi 只在产生 assistant 回复后才写文件，所以新建会话的名字/模型先落在 SQLite 的草稿行（`persisted = 0`），首次回复后索引对齐。
- **schema 演进**：`db/index.ts` 用 `PRAGMA user_version` 记录版本，新增迁移时递增 `SCHEMA_VERSION` 并补一条 DDL；开发初期允许破坏性变更，删本地 `app.db` 重建即可。
- **删除会话**：先停用运行中的资源（`pool.dispose` / `events.remove`），再删 SQLite 行，最后删 JSONL 文件；顺序不能颠倒，见 `docs/database.md`。
- **主题**：`next-themes` + `.dark` class，浅色 / 深色 / 跟随系统三态；首屏由 `index.html` 的内联脚本定色以避免闪白。颜色与圆角全部走语义 token（`DESIGN.md`），`scripts/verify` 会拦下裸色值。

## 验证

```bash
pnpm check     # biome check . && pnpm -r typecheck && pnpm -r test && pnpm verify
pnpm test      # 各包单元测试（Node 内置 node:test，`src/**/__tests__/**/*.test.ts`）
pnpm verify    # 只跑约定校验（scripts/verify）
```

约定校验覆盖六项：SQLite 迁移版本必须从 1 起连续、契约字段必须 camelCase 且 `*Request` 有配对的 `*Input`、
业务组件不得出现裸色值或非语义颜色 utility、i18n 目录中英齐平且禁止硬编码中文、源码禁止硬编码品牌名、
有测试用例的包必须声明 `test` 脚本。对应规范见 `docs/`、`AGENTS.md` 与 `DESIGN.md`。

## 冒烟测试

不走 HTTP，直接用 pi SDK 验证「端点 + 模型 + 工具 + 流式」：

```bash
pnpm smoke
# 或指定参数
pnpm -F @ucode/server smoke -- --base-url http://localhost:8317/v1 --api-key devtest --model glm-5.2
```

## 提示词评测

系统提示词有两套可切换的源（`APP_PROMPT_SOURCE`）：`custom` 自研（默认，正文以 opencode 的
提示词分节与规则为蓝本移植改写）与 `pi` 基线（pi 默认提示词 + 自研片段）。正文按语言存放在
`prompt/locales`（当前仅 `zh-CN`），按模型族在 `prompt/variant.ts` 解析变体（当前统一 `default`）。
哪套更好由评测决定，不看文案观感——`eval` 用真实模型跑一组固定用例，抓工具调用与最终回复做断言，
支持按源对比：

```bash
pnpm eval                                   # 跑默认源
pnpm eval -- --source custom,pi             # 两套源对比
pnpm eval -- --model deepseek-v4-flash,glm-5 --attempts 3   # 多模型 + 每例重复 3 遍看通过率
pnpm eval -- --case read-not-cat            # 只跑指定用例
pnpm -F @ucode/server eval -- --base-url http://localhost:8317/v1 --api-key devtest
```

用例在 `server/scripts/eval.ts` 里集中声明（模式 + 提示词 + 工具 / 回复 / 落盘断言），
需要真实端点，因此不进 `pnpm check`；会写盘的用例在隔离工作区（`.tmp/eval/workspace`）里跑，不碰仓库。
用例断言的是模型行为，存在随机性：用 `--attempts` 看通过率、`--model` 多个模型横向比；
依赖模型自觉行为（如 plan 模式主动调 `present_plan`）的用例标为**可选**（输出里带 `*`），
只报通过率、不计入退出码。

## 常见问题

- **`configured: false`**：还没配 provider，或 `defaultModel` 指向了不存在的 `provider/model`；看 `health` 返回的 `error`。
- **模型列表为空**：`models/list` 只列出配置里有凭证的 provider，检查 `baseUrl` / `apiKey`。
- **`sessionId` 报 400**：id 只接受 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（与 pi 的会话 id 规则一致），新建会话用返回的 UUID。
- **调用上游报 400 `invalid_request`**：多为网关兼容性差异。先用 `config/test` 二分定位，必要时通过模型的 `compat` 关掉 `supportsDeveloperRole`、`supportsStore`、`supportsReasoningEffort` 等开关。
- **端口被占用**：改 `.env` 的 `APP_PORT`，同时改 `apps/web/vite.config.ts` 里的代理目标。
- **⚠️ 安全**：当前版本没有 HTTP 鉴权、默认监听所有网卡，且背后的 agent 有 `bash` 权限。**不要把它暴露到公网或不可信网络**。待办与整改方案见 [`TODO.md`](./TODO.md)。
