# 接口规范

对外 HTTP 接口的传输约定、字段命名与通用结构。契约实现是唯一事实源：请求 zod schema 与响应类型都在
`packages/contracts/`（`@ucode/contracts`），server 与 web 共用同一入口。**本文档与契约不一致时以契约为准。**

本文只声明规范；**逐个接口的请求参数与响应结构**见自动生成的 [`api-reference.md`](./api-reference.md)
（由 `pnpm api:docs` 从 `packages/contracts/` 生成，`pnpm check` 校验其与契约一致），契约实现见 `packages/contracts/`。

## 传输约定

- 前缀 `API_BASE_PATH`（`/api/v1`，由 `API_VERSION` 拼出）
- 除 `GET /api/v1/health`、`GET /api/v1/info`、`GET /api/v1/status`、`GET /api/v1/auth/session`、`GET /api/v1/auth/sessions`、`GET /api/v1/service/info`、`GET /api/v1/attachments/<id>` 与 `POST /api/v1/attachments`（原始字节请求体）外，一律 `POST` + JSON body
- **除放行清单外，全部接口需要鉴权**（见「鉴权」）：未认证返回 `401 unauthorized`，浏览器导航类请求 302 到 `/login`
- **请求参数只放 body，不进路径**：路径只表达「域 + 动作」（`attachments` 的 `<id>` 例外，见「附件」）
- `Content-Type: application/json`；无参数的接口也要发 `{}`（对应的 schema 是 `emptyInputSchema`）
- 事件流 `/events` 是 SSE、附件路由收发原始字节，都不适用上面的 JSON 约定，见各自小节

## 响应封套

非流式接口共用一个封套，成功与失败靠 `success` 区分：

```ts
// 成功
{ success: true,  code: "ok", message: "",    data: <业务数据> }
// 失败
{ success: false, code: "<错误码>", message: "<中文兜底文案>", data: <错误详情或 null>, params?: { … } }
```

- 客户端按 `code` 分支，不依赖 HTTP 状态
- 错误详情（校验 issues、上游响应片段等）放 `data`
- **服务端不做本地化**：`message` 是固定中文，供日志、`curl` 与未登记错误码兜底；
  客户端用 `code` 查 `@ucode/i18n` 的 `errorMessageKeys` 渲染当前语言，`params` 是渲染所需的插值值
- 由 `platform/response` 的 `ok()` / `fail()` 生产，禁止各处手写封套

## 错误码与 HTTP 状态

- 错误码只在 `packages/contracts/src/envelope.ts` 的 `ERROR_CODES` 登记，禁止散落字符串字面量
- 命名 snake_case，取自域名或失败原因
- HTTP 状态只表达传输层语义，与 `code` 的分工：

| 状态 | 何时用 | 对应 code |
| --- | --- | --- |
| 400 | 请求参数校验失败、业务参数非法 | `invalid_request`、`unknown_model` |
| 401 | 未认证或凭证无效 | `unauthorized`、`invalid_credentials` |
| 403 | 已认证但无权限 | `forbidden` |
| 404 | 路由或资源不存在 | `not_found` |
| 409 | 状态冲突（会话正在生成等） | `session_busy`、`model_not_configured` |
| 429 | 触发限流（登录） | `rate_limited` |
| 500 | 未预期异常 | `internal_error` |

配对码相关错误用 400：`pairing_invalid`、`pairing_expired`。

上游相关失败（`upstream_unreachable` / `upstream_error` / `unsupported_api`）按语义归入 400 或 500，
但前端只应读 `code`。

## 路由与动作命名

路径结构 `/api/v1/<域>/<动作>`：

- **域**用单数、小写、名词（`sessions` / `messages` 这类）
- **动作**取自固定动词表，这是封闭词表：新增动作必须先在此登记

| 动作 | 语义 | 返回 |
| --- | --- | --- |
| `list` | 列表查询 | 列表结构 |
| `info` | 单个资源详情 | 详情结构 |
| `create` | 新建 | 资源摘要 |
| `mkdir` | 新建目录 | 目录路径 |
| `update` | 局部更新 | 资源摘要 |
| `delete` | 删除 | 动作回执 |
| `archive` | 归档（软删） | 动作回执 |
| `read` | 标记已读（写上次打开时间） | 资源摘要 |
| `prompt` | 发起生成 | 动作回执 |
| `interrupt` | 中断生成 | 动作回执 |
| `ignore-plan` | 忽略本次计划的决策表单 | 动作回执 |
| `refresh` | 按当前配置重建运行时 | 与 `list` 同形 |
| `test` | 连通性测试 | 测试结果 |
| `respond` | 回答挂起的交互请求 | 动作回执 |
| `login` | 登录并签发会话 | 会话与 token |
| `logout` | 注销当前会话 | 动作回执 |
| `session` | 当前主体身份（whoami） | 主体信息 |
| `sessions` | 活动会话列表 | 列表结构 |
| `revoke` | 撤销指定会话 | 动作回执 |
| `password` | 修改密码（并撤销全部会话） | 动作回执 |
| `host` | 修改服务监听地址 | 服务配置 |

## 字段命名

- JSON 字段一律 **camelCase**
- 缩写按普通单词处理，不整词大写：`sessionId`（非 `sessionID`）、`baseUrl`、`apiKey`、`maxTokens`
- **请求**里指向某个资源的 id 一律 `<资源>Id`：`sessionId`
- **响应**里资源自身的 id 用 `id`（如 `SessionSummary.id`、`MessageDTO.id`）
- 布尔字段用肯定语义，不加 `is` 前缀之外的装饰：`running`、`configured`、`deleted`、`admitted`
- 列表字段用资源的复数名，而不是 `items`：`sessions`、`messages`、`providers`

## 语言与本地化

- **服务端不做本地化**：封套的 `message`、`RuntimeStatus.error`、SSE 错误帧的 `message` 都是固定中文，
  只作为日志 / `curl` 可读性与未登记错误码的兜底。
- **客户端按 `code` 渲染**：`@ucode/i18n` 的 `errorMessageKeys` 把每个 `ERROR_CODES` 映射到一个文案 key，
  客户端用 `t(key, params)` 得到当前语言；映射不到时直接用 `message`。插值所需的 `url` / `status` /
  `ref` / `path` / `api` 走封套与错误帧的 `params`。
- 前端仍以 `code` 分支决定行为。
- 文案目录：`@ucode/i18n` 的 `common`（协议级）、`domain`（错误码文案）、`ui`（产品界面词汇，各端共用）
  都在 `packages/i18n/src/locales/`；各端补充文案走 `createI18n` 的 `appCatalogs`。
  key 用中文文案本身（含 `{{占位}}`），中文目录无需登记——缺失时 i18next 回退为 key 本身并插值；
  只有纯占位模板这类「key 无法表达语义」的文案才用带 `.` 的摘要 key（如 `失败提示.模板`），
  在中英目录各写一份，`en` 是完整目录也是 `t()` 的类型来源。
  组间不得重名，`pnpm check` 的 i18n 校验会拦下越界 / 冗余 key、摘要 key 漏中文、
  错误码映射缺失与（web 侧的）硬编码中文。
- i18n 运行时（house 配置 `createI18n`、目录合并）在 `@ucode/i18n`，只依赖 `i18next`，
  供 web / 未来的 TUI、Electron 复用；各端自持存储（localStorage / 配置）。

## 通用参数

| 参数 | 类型 | 约定 |
| --- | --- | --- |
| `sessionId` | `string` | 会话 id，格式与 pi 的 `assertValidSessionId` 一致（`^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$` 的宽松形式） |
| `q` | `string?` | 模糊搜索；服务端 `trim` + 转小写后匹配，空串等于不过滤 |
| `limit` | `number` | 正整数；schema 必须同时给出 `default` 与 `max`（当前 default 100 / max 500） |
| `offset` | `number` | 分页偏移，非负整数、default 0。**当前无接口使用**，新增分页时按此命名与语义补上 |

- 排序不作为请求参数，由服务端固定（如会话按 `updatedAt DESC`）
- 无参数接口用 `emptyInputSchema`，而不是让 body 可空

## 通用响应结构

| 场景 | 形态 | 示例 |
| --- | --- | --- |
| 列表 | `ListResult & { <资源复数>: T[] }`，其中 `ListResult = { total }` | `SessionListResponse` |
| 详情 | `{ <资源单数>: T, ...附加状态 }` | `SessionInfoResponse` |
| 创建 / 更新 | 直接返回资源摘要（裸对象） | `SessionSummary` |
| 以会话为主体的动作 | `SessionScoped & { <状态布尔>: boolean }` | `SessionArchiveResponse` |

基类型 `ListResult` / `SessionScoped` 定义在 `packages/contracts/src/common.ts`，新接口优先复用，不要重复声明 `total`、`sessionId`。

`total` 一律是**过滤后的总数**，不按 `limit` 截断（用于「显示 n / 共 m」）。

## 可空与省略

- `null` 表示「有意置空 / 无此值」，字段一定存在：`model: string | null`
- 字段缺省表示两种语义，由 schema 区分：
  - **请求**：patch 类接口中缺省 = 不改动该字段（`z.optional()`）
  - **响应**：缺省 = 不适用（`z.optional()`，如 `MessageDTO.model` 只对 assistant 有意义）
- 需要显式清空时传 `null`，不能靠传空串——空串是合法的业务值（如搜索词）

## 时间与数值

- 时间一律 **ISO 8601 UTC 字符串**（`new Date(...).toISOString()`），字段名 `createdAt` / `updatedAt`
- 请求不接收时间字段：时间由服务端产生
- 可排序的时间字符串可直接比较，不需要转成时间戳
- 毫秒数只用于表达「时长 / 耗时」的量：`uptimeMs`、`latencyMs`
- 计数用整数；成本用浮点；比例用 0–1 浮点

## 枚举

- 跨端共享的枚举放 `packages/contracts/src/constants.ts`：`as const` 数组 + 派生类型
  （如 `THINKING_LEVELS`、`API_TYPES`、`MESSAGE_ROLES`、`EVENT_NAMES`）
- 需要请求校验时用 `z.enum(XXX)`；只在响应中用到的字面量联合也从常量派
- 不允许在 server 与 web 各写一份枚举字面量

## 契约组织与类型绑定

- 一个域一对文件：`packages/contracts/src/<域>/input.ts`（请求 zod）与 `output.ts`（响应类型）
- 请求类型分两档，同一 schema 导出两个类型：

  | 类型 | 定义 | 用途 |
  | --- | --- | --- |
  | `*Request` | `z.input<typeof schema>` | 客户端载荷，带默认值的字段可省 |
  | `*Input` | `z.infer<typeof schema>` | server handler 入参，默认值已填充 |

- schema 导出名后缀 `InputSchema`（`sessionListInputSchema`）
- **响应类型必须与实现编译期绑定**：响应生产点显式标注契约类型，内联字面量用 `satisfies XxxResponse`。
  契约改字段后 server 必须编译失败，禁止让响应体停在推断状态。
- 跨域复用的片段放 `common.ts`；响应基类型放 `common.ts`；封套与错误码放 `envelope.ts`

## 事件流

`POST /api/v1/events` 返回 `text/event-stream`，**不套封套**：

- SSE 事件名固定 `message`，真正的类型在 `data` 的 JSON 里
- **会话事件帧**：`{ type, sessionId, seq, data }`
  - `type` 取自 `EVENT_NAMES`；`seq` 是**会话内**单调序号
  - 客户端用 `messages/list` 返回的快照 `seq` 切分：丢弃 `seq <= 快照 seq` 的帧，接续其余帧
  - 除消息流（`message_*` / `tool_*` / `queue_update` / `compaction_*`）外，会话列表的增改删也走这里：
    - `session_created`：载荷 `SessionSummary`，新建 / 分叉 / 子智能体创建
    - `session_updated`：载荷 `{ session: SessionSummary, usage?: UsageTotals, contextUsage?: ContextUsage | null }`，改名 / 换模型 /
      置顶 / 标记已读 / 落定后摘要刷新 / 运行态变化；`usage` 在需要客户端重算占用的帧上带上（落定后、改模型 /
      模式），`contextUsage` 与它同帧。`ContextUsage` 除 `tokens / contextWindow / estimated` 外，还带
      `budget`（本会话的压缩触发点，按 `harness/setup/budget` 的有效预算算，不等于窗口）与 `lastCompaction`
      （最近一次自动压缩的 `{ reason, at }`）——界面据此说明「上下文为什么突然小了」
    - `session_archived`：载荷 `{ sessionId }`，归档（级联子会话逐个下发）
  - 压缩：`compaction_start` 载荷 `{ reason }`（`manual` / `threshold` / `overflow`），`compaction_end` 载荷
    `{ reason, tokensBefore?, estimatedTokensAfter? }`——两个规模字段只在压缩成功时存在，真失败统一走 error 帧
    （`compaction_failed`）。被**正常拒绝**时载荷为 `{ reason, skipped }`（`too_small` / `already_compacted`）：
    没有可总结的跨度或已是压缩后的状态，没做任何事、也不改变会话状态，客户端只弹一条轻提示；
    **自动压缩**失败时载荷为 `{ reason, errorMessage }`（它不中断这一轮，不能标成「本轮出错」）。
    压缩会重写可见历史：早期条目被摘要替代，只剩从 `firstKeptEntryId` 起的保留区间，与 `messages/list` 的投影一致
  - `transcript_reset`：载荷 `{ fromEntryId }`，活动分支或可见历史已改变（编辑重发、追加界面标记、上下文压缩），
    客户端应重取快照；它不参与 `seq` 切分（收到即整表重取）
  - 交互（`interaction_request` / `interaction_resolved`）、目标（`goal_update`）同样在此下发
  - 后台服务（`service_update`）：载荷是**全量** `BackgroundService[]`——bash 命令调起的常驻服务，
    按端口一条（`{ id, command, cwd, port, url, startedAt, updatedAt }`）。清单只含**当前可连**的服务：
    探不到的会被服务端移出，所以条目上没有状态字段；全量替换比 `start` / `end` 对更省心智
  - `messages/list` 的快照还带 `subagents` 与 `services`：两者都不落盘（前者是进行中的委派、
    后者是当前可连的后台服务），断流重连后客户端以快照为准收敛。只要服务清单用
    `messages/services`（响应前重探一次，不重取整段消息历史）
- **控制帧**（无 `sessionId` / `seq`）：`server.connected`、
  `{ type: "error", sessionId?, code, message, params? }`、
  `{ type: "config_changed", config: ConfigSnapshot }`（配置已变更，客户端据此重取 models / health）、
  `{ type: "mcp_changed", mcp: McpListResponse }`、
  `{ type: "plugins_changed", revision: number, plugins: PluginsListResponse }`（插件登记表已变更，
  客户端据此重取列表；代次推进会让相关会话按新装配重装）、
  `{ type: "projects_changed", projects: ProjectListResponse }`（项目改名或写回最近的会话参数）
- 心跳为 `: heartbeat` 注释行，间隔 `EVENTS_HEARTBEAT_MS`
- 订阅者队列满时服务端直接断流，由客户端重连 + 快照补齐，服务端不无限缓冲

## 终端（terminal）

工作台的终端：用户自己的交互式 shell，与 agent 的 `bash` 工具是两条互不相干的通道
（终端不套命令拦截、也不进「后台服务」清单）。

- **按工作目录归口**：`sessionId` 或 `cwd` 二选一，服务端解析成一个真实目录（会话走它的工作目录，
  未绑定目录的会话用它自己的工作区，缺目录时建出来），同目录的会话共用同一批终端。
- `terminal/create`：起一个 PTY，返回 `TerminalInfo`（`id` / `cwd` / `shell` / `cols` / `rows` / `running` /
  `pid` / `exitCode` / `createdAt`）。每个目录至多 `TERMINAL_MAX_PER_CWD` 个同时在跑，超出返回 `terminal_limit`。
- 每个终端带 `sequence`（它在该目录里的创建序号，从 1 起且不回收）：界面靠它稳定地编号。
- `terminal/list`：列该目录下的终端（含已退出的，好在界面上标出退出码）——客户端刷新页面后用它
  把同目录的终端列出来（点开即重新挂上标签）。目录本身不存在时返回空列表，不报错。
- `terminal/resize`：改行列。PTY 的行列决定换行与全屏程序的布局，客户端要在尺寸变化时上报
  （面板实测到变化就报，容器与字号两种变化走同一条路）。
- `terminal/close`：结束终端（杀进程并摘除条目）；已不存在时 `closed: false`，幂等。
- `terminal/ticket`：签一张输出流的**一次性握手票**（30 秒内有效、只能用一次、绑定该终端）。

### 输出流（WebSocket）

`GET /api/v1/terminal/stream` 是 **WebSocket 升级端点**，不是 HTTP 流：

- **握手**：query 带 `terminalId` 与 `ticket`。校验的是那张一次性票而不是长期凭证——
  浏览器的 WebSocket API 不能带 `Authorization` 头、凭证也不走 Cookie（见「鉴权」），
  所以先用一次带鉴权的 `POST /terminal/ticket` 换票。票在鉴权中间件里**预检**（无效或没票直接 401，
  连接根本不会建立），路由只负责**核销**（一次性）。
- **帧**：上行**只认文本帧**（用户输入原文，含控制序列）；下行二进制帧 = PTY 输出的原始字节。
  二进制上行（`addon-attach` 的 `onBinary` 路径）当前没有调用方，服务端记一条 debug 后忽略。
  没有 JSON 包装、也没有第三个通道——客户端的管道由 `@xterm/addon-attach` 承担，
  它会把任何文本消息也写进屏幕，所以服务端只发二进制。
- **连接建立后先重放最近的输出**（服务端保留 `TERMINAL_SCROLLBACK_BYTES`），再转实时；
  重连即重放，客户端在 `open` 时先清屏即可。
- **结束与拒绝由关闭码表达**：`1000` + reason `exit:<code>`（进程结束）、
  `4404`（终端不存在）、`4403`（客户端跟不上输出，可重连后靠重放收敛）、
  `4401`（票在预检通过到核销之间失效，例如同一张票被并发用了两次）。
  无效票与没票更早就被拒了——那一步是握手前的 401，连接不会建立。
- **判活由服务端负责**：每 `TERMINAL_PING_INTERVAL_MS` 发一次 WebSocket ping，上一轮没有 pong 就断开
  （浏览器端拿不到 pong 事件，做不了这件事）。
- **进程只存在于服务进程内存**：不落库、不进会话记录、不随会话回收；服务退出时全部杀掉。
  多个客户端可同时订阅同一终端（同一个 PTY，都能输入）。

## 浏览器（browser）

agent 用的那组浏览器工具（`browser_open` / `browser_snapshot` / `browser_act` / `browser_screenshot` /
`browser_close`）是**会话内的工具调用**，不走 HTTP，所以这里只有 **profile 数据面**：

- `POST /api/v1/browser/list`：列出磁盘上的 profile——`name` / `bytes` / `exact` / `lastUsedAt` / `inUse`，
  外加存放根目录与两个上限（份数、单份占用）。`exact: false` 表示目录太大、只数了个下界。
- `POST /api/v1/browser/delete`：`{ names: string[] }` → `{ deleted, missing, skipped }`。
  **使用中的 profile 跳过**（`skipped[].reason`）——删到一半会把实例正打开着的文件抽走；
  动作表里没有 `clear`，「清空」由调用方先 `list` 再把全集传进来表达。

- `POST /api/v1/browser/desktop`：桌面端浏览器通道的当前状态——`{ connected, tabs }`，每个标签带
  `id` / `title` / `url` / `webContentsId` / `active`。没有桌面端（或一个标签都没开）时 `connected` 为
  false 或 `tabs` 为空。排障与冒烟看它。
- `POST /api/v1/browser/desktop/ticket`：给那条通道签一张一次性握手票（与终端同一个实现）。
- `GET /api/v1/browser/desktop`：通道本体（WebSocket 升级端点，鉴权照终端那套：`?ticket=`）。上行三种消息：
  整份标签集合 `{ type: "tabs", tabs: [...] }`（有变更就重发）、CDP 结果 `{ type: "cdp-result", id, result | error }`、
  CDP 事件 `{ type: "cdp-event", webContentsId, method, params }`；下行一种：`{ type: "cdp", id, webContentsId, method, params }`
  ——服务端按它驱动当前激活的那个标签（见 docs/browser.md）。

数据落在 `$APP_HOME/app/browser/profiles/<name>`，权限 `0700`（里面有 cookie 与 localStorage，属凭证面）。
名字是**单段**、小写字母或数字开头（`^[a-z0-9][a-z0-9._-]{0,63}`），拼路径前校验，挡路径穿越。

## 文件系统（fs）与应用目录

`fs` 域是通用的文件系统浏览入口（会话侧栏的项目目录选择器、输入区的 `@` 检索与工作台的文件预览共用）：

- `fs/list`：`path` 省略时从用户 home 开始，返回当前目录、上级目录与条目列表；
  条目含 `name` / `path` / `type`(`file` | `directory`) / `size` / `updatedAt`，
  服务端固定排序（目录在前、各自按名称）。`type` 过滤默认 `all`，目录选择器传 `directory`；
  `q` 按名称模糊过滤条目（目录选择器以结尾 `/` 区分：带 `/` 进入该目录，不带则把末段当检索词）。
- `fs/read`：读单个文件的内容，给工作台的预览器用。只能读普通文件（目录返回 `not_a_file`）；
  服务端按前 8KB 是否含 NUL 判文本 / 二进制，文本按 1MB、二进制按 5MB 内联，超出时文本按上限截断、
  二进制整块不给，两种情况都由 `truncated` 标注。响应形如
  `{ path, name, size, updatedAt, kind: "text" | "binary", text?, base64?, truncated }`：
  文本给 `text`，二进制给 base64（图片、PDF 等由客户端拼 data URL 或交给专门的渲染器）。
  调用方可用 `maxBytes` 收窄愿意接收的内联体积。
- `fs/mkdir`：单层建目录；已存在返回 `path_exists`，父目录不存在返回 `path_not_found`，
  其余失败（权限、只读等）返回 `mkdir_failed`。
- `fs/search`：受限 walker（尊重 `.gitignore`、跳过 `node_modules` 等），给输入区的 `@` 检索用。
- 路径一律由服务端归一化（`~` 展开 + `realpath`），不存在的路径返回 `path_not_found`。
  **客户端传相对路径时必须自己拼成绝对路径**：服务端的相对路径基准是服务进程的 cwd，不是会话 cwd。
- `fs` 与其他接口一致，需通过鉴权（见「鉴权」）；agent 具备文件读写权限，不要把本服务暴露到不可信网络。

## 资产（assets）

设置页管理角色 / 技能 / 命令三类资产。磁盘形态分别是 `$APP_HOME/agents/<slug>.md`、
`$APP_HOME/skills/<name>/SKILL.md`、`$APP_HOME/prompts/<name>.md`，项目档在 `<项目>/.<slug>/` 下的同名目录。

- `list`：按会话 / cwd 解析目录，返回三类条目（含只读来源与被同名压住的条目）与解析失败的条目。
  `active` 为假表示同名时被优先级更高的来源压住，`overriddenBy` 给出那一条的路径；`editable` 为假即只读来源。
- `read` / `delete`：按 `path` 定位，路径必须落在资产目录内（否则 `path_not_found`）；`delete` 对技能
  连同目录一起删，只读来源报 `asset_read_only`。
- `save`：按 `kind + name + scope` 落盘（不接受路径），`scope` 取 `global` 或 `project`，同名文件即覆盖。
  内容先过运行时同一套校验，失败报 `asset_content_invalid`，`params.reason` 是中文原因。
- 未建模的 frontmatter 行由 `read` 以 `extraLines` 给出，`save` 原样回传即可保留用户自己加的字段。
- 与 `agents/list`、`commands/list` 的分工：后两者是选择器与 `/` 菜单的数据源（只给视图字段），
  本域只服务设置页，故带路径、正文与可写标记。

## Git（只读）

`git` 域给工作台的面板提供仓库状态与 diff，**全部只读**：没有任何 stage / commit / checkout 能力。
服务端直接用系统 git（`execFile`，零依赖），参数固定为白名单（不分页、不上色、禁用外部 diff 与 textconv、
`core.quotepath=false`），用户可控入参只有「仓库内相对路径」与「提交引用」，两者都在服务端校验后才拼进命令。

- `git/status`：`path` 可以是仓库内任意目录，服务端向上找仓库根。返回
  `{ isRepo, repoRoot?, branch?, upstream?, ahead?, behind?, staged[], unstaged[], untracked[], conflicted[] }`。
  不在仓库内时返回 `isRepo: false`（不是错误）；单个文件可能同时出现在 `staged` 与 `unstaged`
  （两侧都改过），客户端按来源区分。条目里的 `path` 是**相对仓库根的 POSIX 路径**，
  `additions` / `deletions` 在未跟踪、重命名与二进制时为 null（无法统计）。
- `git/diff`：单个文件的 diff，`source` 选 `worktree`（工作区 vs index）/ `staged`（index vs HEAD）/
  `commit`（该提交 vs 其父提交，需同时给 `commit`）。返回**结构化的 hunk**
  （`{ path, oldPath?, status, binary, additions, deletions, hunks[{ header, lines[{ kind, oldLine, newLine, text }] }], truncated }`），
  由服务端解析 unified diff，客户端不做文本解析；未跟踪文件按「全文新增」生成。
- `git/contents`：同一个文件**对比两侧的原文**（`file` / `source` / `commit` 语义与 `git/diff` 完全一致），
  给编辑器展开未变更区域用。返回 `{ path, old?: { text?, binary, truncated }, new?: { text?, binary, truncated } }`：
  该侧不存在（新增文件的旧侧 / 删除文件的新侧）时整个字段缺省；二进制或超出内联上限（1MB）时
  只给标志不给 `text`。
- `git/log`：提交历史，倒序分页（`limit` / `skip`），每条含 `hash` / `shortHash` / `subject` /
  `authorName` / `authoredAt` / `refs`。
- `git/show`：单次提交的元信息与改动文件列表（不含 diff 正文），单个文件的 diff 走 `git/diff` 的
  `commit` 分支按需取。
- 服务端**没有文件变更推送**：客户端靠「切回面板时拉一次 + 每轮对话结束（`agent_settled`）后刷新 +
  手动刷新按钮」保持新鲜，不轮询。

## 输入载荷（`messages/prompt` 与 `messages/edit`）

两个接口用同一份载荷描述「用户写了什么」，各项互相独立：

- `text`：容器外的用户正文。`@引用`、`图片 N`、`附件 N.<ext>` 都是正文里的位置标记，服务端按标记就地展开。
- `contexts`：引用列表（绝对或工作目录相对路径 + 可选行范围），服务端读内容后前置成 `<context>` 块。
- `attachments`：附件引用，只带内容 id。
- `command`：提示词命令（最多一条），`{ name, args }`——`args` 是模板占位（`$ARGUMENTS` 等）的取值。
- `skills`：技能调用（可多条，按顺序注入），每项 `{ name, args }`，参数是该技能自己容器里的那段。
- `command` 与 `skills` 可以并存（命令是主指令，技能是附加流程）。

至少一项非空，否则 `invalid_request`；无参数的 `/review`（只有 `command`）算有内容。

**命令名不进正文，名字与参数的边界不由服务端从文本里切**。客户端在发送前把用户写的**方言**文本
（`@ucode/markdown`：`:::command[name]` / `:::skill[name]` 容器、`@路径#L1-L2`、`![](attachment:类型/id)`）
解析成上面这份载荷，手打的 `/name 参数` 由同一层定形；服务端只按名字查模板 / 技能正文，再把命令与技能包成
`<command>` / `<skill>` 边界块（形状见 [`session-entries.md`](./session-entries.md)）。
名字对不上清单（模板被删、技能文件读不出来）时报 400 而不是按普通消息投递：客户端是按清单把它定形成
命令的，静默降级只会让用户写的参数变成发给模型的字面文本。

## 附件（attachments）

附件库是**内容寻址**的：`id` 是内容 sha256（64 位小写 hex），字节落 `$APP_HOME/app/attachments/<id>`，
元数据（mimeType / 文件名 / 大小）在 SQLite 的 `attachment` 表。`messages/prompt` 的 `attachments`
传引用 id，消息里图片的 `url` 指向 `GET` 路由。

- `POST /api/v1/attachments`：上传附件。**请求体是原始字节（非 JSON）**，`Content-Type` 为附件类型，
  文件名走查询串 `?name=`；图片经 pi 归一化（2000px / 5MB）后入库，其它类型原样入库。
  响应走封套，返回 `{ id, mimeType, name, size, kind }`（`kind` 为 `image` / `file`）。
  超过 32MB 返回 `payload_too_large`；图片无法归一化返回 `image_invalid`。
- `GET /api/v1/attachments/<id>`：按 id 返回原始字节（**非 JSON、不走封套**），`Content-Type` 取自
  元数据，带 `Cache-Control: immutable` 与 `ETag`；非法 id 或缺失返回 404。
- 非图片附件（pdf / word 等）本期**只存与引用**：服务端在正文里附一行
  `[附件: <name> (id: <hash>)]`，不解析内容（留给后续 `read_attachment` / MCP）。
- **临时与永久**：上传的附件先是「临时」（`referenced_at` 为空），被 `messages/prompt` 引用后
  转为永久；未被引用的临时附件超过 7 天由服务端后台清理（`referenced_at IS NULL AND
  created_at < now - TTL`）。同一份内容只有一个 id，一旦永久不会回退。

## 项目（projects）

项目是**按会话工作目录（cwd）归口**的一组偏好：侧栏项目区用的展示名，以及「最近一次在该项目里选择的」
模型 / 思考档位 / 模式 / 权限档位。它不属于任何一份会话记录，故不存在会话文件里。

- `projects/list`：全部项目行。`projects` 的次序就是侧栏里的次序。行随会话创建自动登记，不提供删除——
  侧栏的项目来自「有未归档会话的 cwd」，会话全部归档后自然不再显示，行与记住的值保留。
- `projects/update`：改名（`name` 传 `null` 即清空，界面回落目录末段）。
  模型 / 档位 / 模式 / 权限档位**不走这个接口**：它们在会话里选择时由 `sessions/create` /
  `sessions/update` 自动写回，单入口径才不会出现「项目设置」与「会话选择」互相覆盖。
- `projects/reorder`：重排（`paths` 是侧栏里从上到下的项目目录）。只给界面上看得见的那几个，
  没提到的行（会话全部归档了）接在后面——客户端拿不到看不见的行，不该擅自给它们排位；
  拖过后写 `sort_order` 0..n-1，没拖过的按登记时间降序接在最后（新项目落在末尾，
  不插进用户排好的那段里）。响应与 `projects/list` 同形。
- 会话参数的两处交汇：新建会话时请求里缺的项按项目记住的值补（`sessions/create`），
  用户在会话里改了就写回项目（`sessions/update`）。子智能体与分叉继承来的值不算「用户选择」，都不写回。
- 写入（改名、重排或写回默认值）都会广播控制帧 `projects_changed`（整份列表）：写回是「在会话里改了参数」的
  副作用，不发的话各端手上的还是连接时加载的那份旧值。
- 项目里的默认值只在读取时校验可用性：模型已不可用、模式角色已移除、枚举非法的一律按「未设置」回落，
  不让陈旧值把新建会话打成 `unknown_model`。
- 助理工作区（`<workspace>/<sessionId>`）不是项目：那是服务分配给未绑定目录的会话的目录。

## 交互请求（interactions）

「服务端提问、前端回答」的请求-响应通道：生成过程中服务端挂起一条请求，等前端答复后才继续。
按 `kind` 判别两类：

- `permission`：工具调用命中 `ask` 规则，用户答 `allow_once` / `allow_session` / `deny`。
  会话权限档位（`permissionMode`）决定命中 `ask` 时是否真的产生请求：`auto` 自动放行常规工具、
  `full` 连越界目录一并放行，`deny` 在任何档位都保持阻断（语义见 [模式与权限](./modes-and-permissions.md)）。
- `question`：模型经 `question` 工具向用户提问，用户从选项中选择或自填；答复为 `answers: string[][]`，
  与问题同序，每项是该问题选中的标签或自填文本，空数组表示用户跳过。

- 请求下发：SSE 事件 `interaction_request`（载荷 `PendingInteraction`）；答复或请求失效后下发
  `interaction_resolved`（`{ requestId }`）。权限审批的载荷额外带 `tool` / `subject` / `scope`：
  `scope` 是本次授权覆盖的范围，规则类 ask 是规则串，越界检查（`external_directory`）是父目录通配。
- `interactions/list`：按 `sessionId` 列出尚未回答的请求，供刷新 / 重连后补齐对话框。
- `interactions/respond`：按 `kind` 判别提交答复，返回 `{ requestId, resolved }`。
  `kind` 与待答请求不一致时不结算，重复回答或请求已失效也为 `resolved: false`。
- 生命周期：请求只在进程内存，**不设等待时限**，无人答复就一直挂着。本轮中断（stop）按各 kind 的
  失败姿态结算（审批拒绝、提问取消），两者都以可读结果回给模型；会话归档时两类请求一并结算清理。
  `allow_session` 等价于按 `scope` 追加一条会话级 allow 规则，同样只存进程内存，服务重启回到规则默认。
- **多客户端**：请求经事件流广播到所有已连接客户端，**任一客户端可作答、首个响应结算生效**（其余端收到
  `interaction_resolved` 后收起对话框）。

## 插件与市场（plugins / marketplace）

插件是**资源与受信任代码的打包单位**：技能 / 命令 / 角色 / 钩子 / MCP / bin / 扩展打成可启停、
可分发、可升级的单元，包格式兼容 Claude Code 与 ZCode。使用与安全边界见 [插件](./plugins.md)，
这里只记接口口径。

- **身份**：`id` 为 `<name>@<marketplace>`；直接登记本地目录时市场名用保留值 `local`。
  插件名与市场名同一套字符集（小写字母或数字开头，只含小写字母、数字与 `. _ -`）。
- **来源**：`pluginCreate` 收 `directory` / `url` / `npm` / `github` / `git` 五种（Claude 的
  `command` 一类不在 schema 内，校验阶段就拒，不会走到运行期再静默失败）；市场只收
  `directory` / `url` / `github` / `git`——市场本体是清单文件而不是包，所以没有 `npm`。
- `plugins/list`：可带 `cwd`。给了就按它读项目级覆盖（`<cwd>/.<slug>/plugins.json` 与
  `plugins.local.json`），每条插件的 `enabled` / `enabledBy` 是**该仓库里的生效值**；不给只算用户级。
  项目文件只能开关**已登记**的插件，不能装新插件（那是把新代码带进这台机器）。
- `plugins/create`：登记即启用（`enabled` 默认 true）。安装副本一律落用户级
  （`$APP_HOME/plugins/cache/<市场>/<插件>/<版本>`，`directory` 来源不复制），仓库维度只由上面的覆盖决定。
- `plugins/update`：启停（`enabled`）与写 `userConfig` 的值（标量，类型由插件清单声明）。
- `plugins/delete`：默认只移除登记；`purge: true` 一并清掉插件根内的缓存与插件数据目录，
  但 `directory` 来源的内容永远不删——那是用户自己的目录。
- `plugins/refresh`：按来源重读清单。换版本 / 同版本重拉时旧副本改名成 `.orphaned-<版本>-<时间戳>`
  保留 14 天（正在跑的会话可能还握着旧路径），到期在下次安装 / 重拉 / 卸载时清掉。
- **来源门控**：执行类组件（`hooks` / `extensions` / `bin`）只对随包（`official`）与本地登记（`local`）
  注入运行时，来自第三方市场（`market`）的**只解析出诊断、不注入**。它的后果是「组件不生效 +
  诊断里说明」而不是拒绝请求，因此没有信任 / 授权类错误码。MCP 不在这条门控里（它另起进程，
  不在你的会话里跑代码）。
- `marketplace/{list,info,create,delete,refresh}`：`info` 读上一次刷新出的条目缓存，不触发网络；
  删除只移除登记，已有缓存与已装插件不受影响。
- **代次与重装**：登记表变化推进 revision 并广播 `plugins_changed`。正在进行的会话按新装配重装，
  正在生成、等待审批 / 回答 / 计划确认的会话先让这一轮走完（只标脏，落定后回收）。

## 鉴权

服务本质是一个 web 服务，鉴权复用标准 web 模型：**单一鉴权管线**把 `Authorization: Bearer` 解析为同一「主体（principal）」，通过鉴权后仍受内层权限引擎约束（鉴权是外层门）。头里既可能是原生客户端的 `serviceToken`，也可能是浏览器登录 / 配对换来的会话 token。**不放 Cookie**：Cookie 不区分端口，同 host 上并存的两个实例会互相顶掉会话。完整方案见 [`plans/service-and-auth.md`](../plans/service-and-auth.md)。

### 放行清单

未认证可访问的只有：`GET /api/v1/health`、`GET /api/v1/info`、`POST /api/v1/auth/login`、`POST /api/v1/auth/pairing/redeem`（一次性码本身就是凭证）与 `OPTIONS` 预检。其余接口一律需要鉴权，未认证返回 `401 unauthorized`；导航类请求不再 302 到 `/login`，由前端闸门自己跳。

### 三种接入路径

| 路径 | 谁用 | 凭证 |
| --- | --- | --- |
| 本机原生客户端 | TUI / CLI / 桌面壳 | `serviceToken`，`Authorization: Bearer <token>`，免交互 |
| 密码登录 | 浏览器（本机 / 局域网 / 远程） | `password` 换取会话 token，由客户端保管并放进请求头 |
| 一次性配对 | 局域网 / 远程 | `POST /api/v1/auth/pairing/create` 生成短 TTL 单次链接（`…/?connect=<code>`），页面调 `POST /api/v1/auth/pairing/redeem` 兑换成会话 token |

解析顺序：先与 `serviceToken` 做常量时间比较，不中再按 sha256 查 `auth_session`。前者不是会话，故 `sessionId` 为 `null`、没有可登出的对象。

### 凭证与会话

- `serviceToken` 与 `password` 明文存 `$APP_HOME/app/service.json`（权限 `0600`，服务独占写）；「读得到文件」即本机身份证明。密码首次启动自动生成，忘记可直接查看该文件。
- 比较一律常量时间；登录接口按来源 IP 限流（`rate_limited`）。
- 会话落 SQLite `auth_session`：库内只存 token 的 sha256，明文只在登录 / 兑换响应里回一次；默认 30 天，可列举、可逐个撤销，改密码撤销全部。
- **凭证由客户端持有**：浏览器把 token 存 `localStorage`（键由品牌 slug 派生，按 origin 隔离，故同 host 不同端口的两个实例各存各的），刷新不掉登录、不用为每个实例换 Cookie 名。代价是 token 对页面 JS 可读 —— XSS 即等于会话泄露，这是不用 `HttpOnly` Cookie 换来的取舍。
- 凭证固定走请求头，故浏览器直链（`<img src>` / `<a href>`）不能直接指向附件接口：客户端先从 `attachments/{id}` 取回字节再转 blob URL。桌面壳在 webview 层注入同一个头，走的也是同一条路。

### 边界

- **不做 IP 信任**：loopback 不自动放行（DNS rebinding 下任意网页都能请求 `127.0.0.1`）。
- CORS 由白名单开放（`APP_CORS_ORIGIN` 逗号分隔，缺省不放行跨域来源），预检放行 `content-type` 与 `authorization`；凭证不走 Cookie，因此不需要 `credentials`，也不再存在 CSRF 面。
- 服务默认监听 `127.0.0.1`；`APP_HOST=0.0.0.0`（或设置里开启局域网访问）才允许同网段访问，且启动会告警。
- **通过鉴权 = owner = 本机 `bash`**：远程接入的提示必须在界面上显式给出；角色 / 权限分级暂缓，principal 预留 `scopes`（当前恒为 `["*"]`）。

## 版本与破坏性变更

- 版本体现在路径前缀 `API_VERSION`（当前 `v1`）；`GET /api/v1/info` 返回 `version`（服务端版本，取根 `package.json`）、`apiVersion`（同 `API_VERSION`）与 `compatRange`（可被哪些客户端版本使用，只比主次版本）
- 破坏性变更（删字段、改字段语义、改响应形状）必须递增 `API_VERSION`；纯增量（加可选字段）不需要
- 项目处于开发初期，`v1` 内允许破坏性调整，但必须同步更新本文件、`CHANGELOG` 与 web 侧引用
