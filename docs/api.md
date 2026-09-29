# 接口规范

对外 HTTP 接口的传输约定、字段命名与通用结构。契约实现是唯一事实源：请求 zod schema 与响应类型都在
`packages/contracts/`（`@ucode/contracts`），server 与 web 共用同一入口。**本文档与契约不一致时以契约为准。**

本文只声明规范，**不维护接口清单**——否则每加一个接口都要回来改文档。对外说明见 `README` 的接口表，
契约见 `packages/contracts/`。

## 传输约定

- 前缀 `API_BASE_PATH`（`/api/v1`，由 `API_VERSION` 拼出）
- 除 `GET /api/v1/health` 外，一律 `POST` + JSON body
- **请求参数只放 body，不进路径**：路径只表达「域 + 动作」
- `Content-Type: application/json`；无参数的接口也要发 `{}`（对应的 schema 是 `emptyInputSchema`）
- 事件流 `/events` 是 SSE，不适用上面的 JSON 约定，见「事件流」

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
- 由 `lib/response` 的 `ok()` / `fail()` 生产，禁止各处手写封套

## 错误码与 HTTP 状态

- 错误码只在 `packages/contracts/src/envelope.ts` 的 `ERROR_CODES` 登记，禁止散落字符串字面量
- 命名 snake_case，取自域名或失败原因
- HTTP 状态只表达传输层语义，与 `code` 的分工：

| 状态 | 何时用 | 对应 code |
| --- | --- | --- |
| 400 | 请求参数校验失败、业务参数非法 | `invalid_request`、`unknown_model` |
| 404 | 路由或资源不存在 | `not_found` |
| 409 | 状态冲突（会话正在生成等） | `session_busy`、`model_not_configured` |
| 500 | 未预期异常 | `internal_error` |

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
| `update` | 局部更新 | 资源摘要 |
| `delete` | 删除 | 动作回执 |
| `prompt` | 发起生成 | 动作回执 |
| `interrupt` | 中断生成 | 动作回执 |
| `refresh` | 按当前配置重建运行时 | 与 `list` 同形 |
| `test` | 连通性测试 | 测试结果 |

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
  key 用中文原文（长文案用中文摘要 key），同组中英 key 必须齐平、组间不得重名，
  `pnpm check` 的 i18n 校验会拦下漂移、重名、错误码映射缺失与（web 侧的）硬编码中文。
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
| 以会话为主体的动作 | `SessionScoped & { <状态布尔>: boolean }` | `SessionDeleteResponse` |

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
- 会话事件帧：`{ type, sessionId, seq, data }`
  - `type` 取自 `EVENT_NAMES`；`seq` 是**会话内**单调序号
  - 客户端用 `messages/list` 返回的快照 `seq` 切分：丢弃 `seq <= 快照 seq` 的帧，接续其余帧
- 控制帧：`{ type: "server.connected" }`、`{ type: "error", sessionId?, code, message }`
- 心跳为 `: heartbeat` 注释行，间隔 `EVENTS_HEARTBEAT_MS`
- 订阅者队列满时服务端直接断流，由客户端重连 + 快照补齐，服务端不无限缓冲

## 版本与破坏性变更

- 版本体现在路径前缀 `API_VERSION`（当前 `v1`），`health` 的 `apiVersion` 同源
- 破坏性变更（删字段、改字段语义、改响应形状）必须递增 `API_VERSION`；纯增量（加可选字段）不需要
- 项目处于开发初期，`v1` 内允许破坏性调整，但必须同步更新本文件、`CHANGELOG` 与 web 侧引用
