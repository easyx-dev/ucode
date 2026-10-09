# 接口参考

> 本文件由 `pnpm api:docs` 从 `packages/contracts/` 生成，**请勿手改**；`pnpm check` 会校验它与契约一致。
> 传输约定、封套、错误码、字段命名等通用规范见 [接口规范](./api.md)。

## 约定速览

- 前缀 `/api/v1`；除 `GET /api/v1/health`、`GET /api/v1/info`、`GET /api/v1/status`、`GET /api/v1/auth/session`、`GET /api/v1/auth/sessions`、`GET /api/v1/service/info`、`GET /api/v1/attachments/<id>` 与 `POST /api/v1/attachments`（原始字节请求体）外一律 `POST` + JSON body，无参数接口也要发 `{}`
- 非流式响应共用封套：成功 `{ success: true, code: "ok", message: "", data }`；失败 `{ success, code, message, data, params? }`
- 字段一律 camelCase；请求里指向资源的 id 用 `<资源>Id`，响应里资源自身用 `id`
- 类型文本中的链接指向文末「公共类型」；`（…）` 内为该字段的取值约束

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/health` | 存活探针（最小载荷，未认证可访问） |
| GET | `/api/v1/info` | 服务发现与版本兼容（未认证可访问） |
| GET | `/api/v1/status` | 认证后的运行时状态（原 health 富载荷） |
| POST | `/api/v1/auth/login` | 密码登录，成功返回会话与 token |
| POST | `/api/v1/auth/logout` | 注销当前会话 |
| GET | `/api/v1/auth/session` | 当前主体身份（whoami） |
| GET | `/api/v1/auth/sessions` | 列出活动会话 |
| POST | `/api/v1/auth/sessions/revoke` | 按会话 id 撤销指定会话 |
| POST | `/api/v1/auth/password` | 修改超管密码并撤销全部会话 |
| POST | `/api/v1/auth/pairing/create` | 签发一次性配对链接（5 分钟、单次使用） |
| POST | `/api/v1/auth/pairing/redeem` | 兑换一次性配对码，成功返回会话与 token |
| GET | `/api/v1/service/info` | 当前监听地址配置与是否需重启生效 |
| POST | `/api/v1/service/host` | 修改监听地址（127.0.0.1 仅本机 / 0.0.0.0 局域网，需重启生效） |
| POST | `/api/v1/models/list` | 供应商目录（内置 + 自定义）与各自的模型、接入状态 |
| POST | `/api/v1/models/refresh` | 按当前配置重建运行时后返回最新目录 |
| POST | `/api/v1/config/info` | 当前配置（apiKey 脱敏）与运行时状态 |
| POST | `/api/v1/config/update` | 局部更新配置并热重载 |
| POST | `/api/v1/config/test` | 按给定端点做一次连通性测试 |
| POST | `/api/v1/config/fetch-models` | 按 provider 端点拉模型列表并推断各项能力 |
| POST | `/api/v1/sessions/list` | 会话列表，可按名称搜索、按父子过滤 |
| POST | `/api/v1/sessions/create` | 新建会话（首次回复后才落盘） |
| POST | `/api/v1/sessions/info` | 会话详情 + 用量 + 当前目标 |
| POST | `/api/v1/sessions/update` | 重命名 / 换模型 / 换推理等级 / 换模式 / 换权限档位 / 置顶 |
| POST | `/api/v1/sessions/archive` | 归档会话（软删：从列表隐藏，文件保留） |
| POST | `/api/v1/sessions/read` | 标记会话已读（写上次打开时间） |
| POST | `/api/v1/sessions/fork` | 从某个条目分叉出新会话 |
| POST | `/api/v1/messages/list` | 会话历史快照（compaction 感知，带接续 seq） |
| POST | `/api/v1/messages/prompt` | 投递一轮生成，返回受理 ack；结果走 /events |
| POST | `/api/v1/messages/edit` | 编辑一条已发送的用户消息并重发 |
| POST | `/api/v1/messages/interrupt` | 中断当前生成 |
| POST | `/api/v1/messages/compact` | 手动压缩上下文（后台执行，走 compaction_* 事件） |
| POST | `/api/v1/messages/ignore-plan` | 忽略本次计划的决策表单 |
| POST | `/api/v1/messages/approve-plan` | 批准计划（注入开工指令并起一轮） |
| POST | `/api/v1/events` | 全局 SSE 事件流（所有会话的实时事件） |
| POST | `/api/v1/interactions/list` | 列出会话中尚未回答的交互请求 |
| POST | `/api/v1/interactions/respond` | 回答一条挂起的交互请求（按 kind 判别） |
| POST | `/api/v1/fs/list` | 浏览目录条目 |
| POST | `/api/v1/fs/search` | 按名模糊检索文件（受跳目录 / 深度 / 条数约束） |
| POST | `/api/v1/fs/mkdir` | 新建目录（单层） |
| POST | `/api/v1/fs/read` | 读取单个文件的内容（文本内联，二进制给 base64） |
| POST | `/api/v1/git/status` | 仓库状态与分组的变更列表（只读） |
| POST | `/api/v1/git/diff` | 单文件的结构化 diff（工作区 / index / 某次提交） |
| POST | `/api/v1/git/log` | 提交历史（倒序分页） |
| POST | `/api/v1/git/show` | 单次提交的元信息与改动文件列表 |
| POST | `/api/v1/mcp/list` | 列出已配置的 MCP 服务器 |
| POST | `/api/v1/mcp/upsert` | 按 name 覆盖写入 MCP 服务器 |
| POST | `/api/v1/mcp/delete` | 按 name 删除 MCP 服务器 |
| POST | `/api/v1/agents/list` | 列出可选的 primary / subagent 角色 |
| POST | `/api/v1/attachments` | 上传附件（请求体为原始字节，文件名走 ?name=；图片归一化后入库） |
| GET | `/api/v1/attachments/:id` | 按 id 返回附件原始字节（非 JSON，不走封套） |
| POST | `/api/v1/commands/list` | 列出可用的提示词命令与技能 |
| POST | `/api/v1/goals/set` | 设定 / 替换当前会话目标 |
| POST | `/api/v1/goals/status` | 查看当前会话目标状态 |
| POST | `/api/v1/goals/pause` | 暂停目标自动续跑 |
| POST | `/api/v1/goals/resume` | 恢复目标自动续跑 |
| POST | `/api/v1/goals/clear` | 清除当前会话目标 |
| POST | `/api/v1/stats/summary` | 全局 token 用量统计（按模型 / 会话聚合） |

## 健康检查（`health`）

### GET /api/v1/health

存活探针（最小载荷，未认证可访问）

**请求参数**

无参数

**响应类型**：`HealthMinimalResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `up` | boolean | 是 | — |
| `version` | string | 是 | 服务端版本（根 package.json 的 version） |

## 服务发现（`info`）

### GET /api/v1/info

服务发现与版本兼容（未认证可访问）

**请求参数**

无参数

**响应类型**：`ServerInfoResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | string | 是 | 服务端版本 |
| `apiVersion` | string | 是 | 接口契约版本（与 API_BASE_PATH 同源） |
| `compatRange` | string | 是 | 本服务可被哪些客户端版本使用，semver range 字符串（如 `^0.2.0`） |

## 运行时状态（`status`）

### GET /api/v1/status

认证后的运行时状态（原 health 富载荷）

**请求参数**

无参数

**响应类型**：`StatusResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 是否已有可用模型 |
| `defaultModel` | string \| null | 是 | 实际生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | 生效的 thinking 档位 |
| `error` | string \| null | 是 | 未就绪时的原因说明 |
| `workspace` | string | 是 | 助理根目录：未绑定工作目录的会话，工作区是它下面以会话 id 命名的那层 |
| `activeSessions` | number | 是 | 内存中驻留的 AgentSession 数 |
| `uptimeMs` | number | 是 | 进程已运行时长 |

## 鉴权（`auth`）

### POST /api/v1/auth/login

密码登录，成功返回会话与 token

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `password` | string（长度≥1） | 是 | — | — |
| `label` | string（长度≤60） | 否 | — | — |

**响应类型**：`AuthLoginResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `session` | [AuthSessionView](#authsessionview) | 是 | — |
| `token` | string | 是 | — |

### POST /api/v1/auth/logout

注销当前会话

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`AuthLogoutResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revoked` | boolean | 是 | — |

### GET /api/v1/auth/session

当前主体身份（whoami）

**请求参数**

无参数

**响应类型**：`WhoamiResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "owner" | 是 | — |
| `scopes` | string[] | 是 | 角色 / 权限分级暂缓，当前恒为 ["*"]（见 plans/service-and-auth.md §3.8） |
| `session` | [AuthSessionView](#authsessionview) \| null | 是 | — |

### GET /api/v1/auth/sessions

列出活动会话

**请求参数**

无参数

**响应类型**：`AuthSessionListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `sessions` | [AuthSessionView](#authsessionview)[] | 是 | — |

### POST /api/v1/auth/sessions/revoke

按会话 id 撤销指定会话

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `authSessionId` | string（长度≥1） | 是 | — | — |

**响应类型**：`AuthSessionRevokeResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revoked` | boolean | 是 | — |

### POST /api/v1/auth/password

修改超管密码并撤销全部会话

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `currentPassword` | string（长度≥1） | 是 | — | — |
| `newPassword` | string（长度 8–128） | 是 | — | — |

**响应类型**：`AuthPasswordResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revokedSessions` | number | 是 | — |

### POST /api/v1/auth/pairing/create

签发一次性配对链接（5 分钟、单次使用）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`PairingCreateOutput`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 完整可访问地址，形如 http://<lan-ip>:<port>/?connect=<code> |
| `code` | string | 是 | 一次性码 |
| `expiresAt` | string | 是 | 过期时间（ISO 8601 UTC） |

### POST /api/v1/auth/pairing/redeem

兑换一次性配对码，成功返回会话与 token

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `code` | string（长度≥1） | 是 | — | — |

**响应类型**：`AuthPairingRedeemResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `session` | [AuthSessionView](#authsessionview) | 是 | — |
| `token` | string | 是 | — |

## 服务（`service`）

### GET /api/v1/service/info

当前监听地址配置与是否需重启生效

**请求参数**

无参数

**响应类型**：`ServiceInfoResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `host` | string | 是 | 注册文件里配置的监听地址 |
| `restartRequired` | boolean | 是 | 是否需要重启服务才能让配置生效（进程当前实际绑定地址与配置不同） |

### POST /api/v1/service/host

修改监听地址（127.0.0.1 仅本机 / 0.0.0.0 局域网，需重启生效）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `host` | "127.0.0.1" \| "0.0.0.0" | 是 | — | — |

**响应类型**：`ServiceHostResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `host` | string | 是 | — |
| `restartRequired` | boolean | 是 | — |

## 模型目录（`models`）

### POST /api/v1/models/list

供应商目录（内置 + 自定义）与各自的模型、接入状态

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`ModelsResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 是否已有可用模型 |
| `defaultModel` | string \| null | 是 | 实际生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | 生效的 thinking 档位 |
| `error` | string \| null | 是 | 未就绪时的原因说明 |
| `providers` | [CatalogProvider](#catalogprovider)[] | 是 | — |

### POST /api/v1/models/refresh

按当前配置重建运行时后返回最新目录

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`ModelsResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 是否已有可用模型 |
| `defaultModel` | string \| null | 是 | 实际生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | 生效的 thinking 档位 |
| `error` | string \| null | 是 | 未就绪时的原因说明 |
| `providers` | [CatalogProvider](#catalogprovider)[] | 是 | — |

## 配置（`config`）

### POST /api/v1/config/info

当前配置（apiKey 脱敏）与运行时状态

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`ConfigSnapshot`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `config` | [ConfigView](#configview) | 是 | — |
| `status` | [RuntimeStatus](#runtimestatus) | 是 | — |

### POST /api/v1/config/update

局部更新配置并热重载

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `providers` | object[] | 否 | — | — |
| `providers[].id` | string（格式 `^[A-Za-z0-9][A-Za-z0-9._-]*$`） | 是 | — | — |
| `providers[].name` | string（长度≥1） | 否 | — | — |
| `providers[].baseUrl` | string（长度≥1） | 否 | — | 留空表示沿用 pi 内置目录的同名 provider；自定义 provider 必须给出 |
| `providers[].api` | "openai-completions" \| "openai-responses" \| "anthropic-messages" \| "google-generative-ai" \| "mistral-conversations" \| "azure-openai-responses" \| "openai-codex-responses" \| "bedrock-converse-stream" \| "google-vertex" \| "pi-messages" | 否 | `openai-completions` | — |
| `providers[].apiKey` | string（长度≥1） | 否 | — | — |
| `providers[].headers` | Record<string, string> | 否 | — | — |
| `providers[].authHeader` | boolean | 否 | — | 是否自动补 `Authorization: Bearer` 请求头 |
| `providers[].compat` | Record<string, unknown> | 否 | — | provider 级兼容开关，作用于其下所有模型；模型级同名项优先 |
| `providers[].models` | object[]（≥1 项） | 否 | — | 留空表示模型清单沿用 pi 内置目录；一旦给出即为整体替换（不是按 id 合并） |
| `providers[].models[].id` | string（长度≥1） | 是 | — | — |
| `providers[].models[].name` | string（长度≥1） | 否 | — | — |
| `providers[].models[].api` | "openai-completions" \| "openai-responses" \| "anthropic-messages" \| "google-generative-ai" \| "mistral-conversations" \| "azure-openai-responses" \| "openai-codex-responses" \| "bedrock-converse-stream" \| "google-vertex" \| "pi-messages" | 否 | — | — |
| `providers[].models[].baseUrl` | string（长度≥1） | 否 | — | — |
| `providers[].models[].reasoning` | boolean | 否 | `false` | — |
| `providers[].models[].thinkingLevelMap` | object | 否 | — | 留空时按厂商默认映射；显式给出的档位覆盖厂商默认 |
| `providers[].models[].thinkingLevelMap.off` | string \| null | 否 | — | — |
| `providers[].models[].thinkingLevelMap.minimal` | string \| null | 否 | — | — |
| `providers[].models[].thinkingLevelMap.low` | string \| null | 否 | — | — |
| `providers[].models[].thinkingLevelMap.medium` | string \| null | 否 | — | — |
| `providers[].models[].thinkingLevelMap.high` | string \| null | 否 | — | — |
| `providers[].models[].thinkingLevelMap.xhigh` | string \| null | 否 | — | — |
| `providers[].models[].thinkingLevelMap.max` | string \| null | 否 | — | — |
| `providers[].models[].input` | ("text" \| "image")[]（≥1 项） | 否 | `["text"]` | — |
| `providers[].models[].inputLimits` | object | 否 | — | — |
| `providers[].models[].inputLimits.maxRequestBytes` | integer（>0） | 否 | — | 单次请求序列化后的体积上限（字节） |
| `providers[].models[].inputLimits.images` | object | 否 | — | — |
| `providers[].models[].inputLimits.images.resize` | object | 否 | — | — |
| `providers[].models[].inputLimits.images.resize.maxWidth` | integer（>0） | 否 | — | — |
| `providers[].models[].inputLimits.images.resize.maxHeight` | integer（>0） | 否 | — | — |
| `providers[].models[].inputLimits.images.resize.maxBytes` | integer（>0） | 否 | — | — |
| `providers[].models[].inputLimits.images.resize.jpegQuality` | integer（≥1，≤100） | 否 | — | — |
| `providers[].models[].inputLimits.images.maxPerMessage` | integer（>0） | 否 | — | — |
| `providers[].models[].inputLimits.images.maxPerRequest` | integer（>0） | 否 | — | — |
| `providers[].models[].contextWindow` | integer（>0） | 否 | `128000` | — |
| `providers[].models[].contextBudget` | integer（>0） | 否 | — | 有效上下文预算（token）：到达它就压缩，留空按窗口推算（见 `harness/budget`）。 单步延迟随上下文线性上升，而各模型的实际退化点相差很大（声明窗口常常远大于可用窗口）， 这里给一个人工覆盖的口子。 |
| `providers[].models[].maxTokens` | integer（>0） | 否 | `8192` | — |
| `providers[].models[].cost` | object | 否 | `{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}` | — |
| `providers[].models[].cost.input` | number（≥0） | 否 | `0` | — |
| `providers[].models[].cost.output` | number（≥0） | 否 | `0` | — |
| `providers[].models[].cost.cacheRead` | number（≥0） | 否 | `0` | — |
| `providers[].models[].cost.cacheWrite` | number（≥0） | 否 | `0` | — |
| `providers[].models[].cost.tiers` | object[] | 否 | — | — |
| `providers[].models[].cost.tiers[].input` | number（≥0） | 是 | — | — |
| `providers[].models[].cost.tiers[].output` | number（≥0） | 是 | — | — |
| `providers[].models[].cost.tiers[].cacheRead` | number（≥0） | 是 | — | — |
| `providers[].models[].cost.tiers[].cacheWrite` | number（≥0） | 是 | — | — |
| `providers[].models[].cost.tiers[].inputTokensAbove` | number（≥0） | 是 | — | — |
| `providers[].models[].promptCache` | object | 否 | — | — |
| `providers[].models[].promptCache.short` | number（≥0） | 否 | — | — |
| `providers[].models[].promptCache.long` | number（≥0） | 否 | — | — |
| `providers[].models[].samplingParams` | Record<string, unknown> | 否 | — | 该模型的默认采样参数，单次请求可覆盖 |
| `providers[].models[].headers` | Record<string, string> | 否 | — | — |
| `providers[].models[].compat` | Record<string, unknown> | 否 | — | pi 的 OpenAICompletionsCompat 等兼容开关，原样透传给 pi 的 provider 配置。 具体字段随 api 收窄，详见 pi 的 *Compat 类型。 应用默认会补上 supportsDeveloperRole: false（部分网关只认 system role）。 |
| `defaultModel` | string（长度≥1） \| null | 否 | — | — |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | — | — |
| `websearch` | object | 否 | — | — |
| `websearch.provider` | "tavily" \| "searxng" \| "brave" | 否 | — | — |
| `websearch.apiKey` | string | 否 | — | — |
| `websearch.baseUrl` | string | 否 | — | — |
| `memory` | object | 否 | — | — |
| `memory.enabled` | boolean | 否 | — | — |

**响应类型**：`ConfigSnapshot`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `config` | [ConfigView](#configview) | 是 | — |
| `status` | [RuntimeStatus](#runtimestatus) | 是 | — |

### POST /api/v1/config/test

按给定端点做一次连通性测试

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `baseUrl` | string（长度≥1） | 是 | — | — |
| `apiKey` | string | 否 | — | 留空时回落到 providerId 已保存的 key |
| `providerId` | string（长度≥1） | 否 | — | — |
| `api` | "openai-completions" \| "openai-responses" \| "anthropic-messages" \| "google-generative-ai" \| "mistral-conversations" \| "azure-openai-responses" \| "openai-codex-responses" \| "bedrock-converse-stream" \| "google-vertex" \| "pi-messages" | 否 | `openai-completions` | — |
| `model` | string（长度≥1） | 是 | — | — |

**响应类型**：`ConfigTestResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `latencyMs` | number | 是 | 上游响应耗时 |
| `modelEcho` | string \| null | 是 | 上游回显的模型 id，未回显时为 null |
| `url` | string | 是 | 实际请求的 chat/completions 地址 |

### POST /api/v1/config/fetch-models

按 provider 端点拉模型列表并推断各项能力

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `providerId` | string（长度≥1） | 否 | — | 对应已保存的 provider；用于回落 apiKey，并作为能力推断的比对来源 |
| `baseUrl` | string（长度≥1） | 是 | — | 上游端点根地址，末尾斜杠会被去掉后拼 `/models` |
| `apiKey` | string | 否 | — | 留空时回落到 providerId 已保存的 key |
| `api` | "openai-completions" \| "openai-responses" \| "anthropic-messages" \| "google-generative-ai" \| "mistral-conversations" \| "azure-openai-responses" \| "openai-codex-responses" \| "bedrock-converse-stream" \| "google-vertex" \| "pi-messages" | 否 | `openai-completions` | — |

**响应类型**：`ProviderModelsResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 实际请求的 `/models` 地址 |
| `latencyMs` | number | 是 | 上游响应耗时 |
| `models` | [ProviderModelSuggestion](#providermodelsuggestion)[] | 是 | — |
| `truncated` | boolean | 是 | 上游返回条数超过上限，只回了前面一段 |

## 会话（`sessions`）

### POST /api/v1/sessions/list

会话列表，可按名称搜索、按父子过滤

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `q` | string | 否 | — | — |
| `limit` | integer（>0，≤500） | 否 | `100` | — |
| `parentSessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | 列表的父子过滤：缺省只出根会话（`parentSessionId` 为空的）； 传某个会话 id 时改为列出它的子会话。见 `plans/stage-7c-subagents.md`。 |

**响应类型**：`SessionListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `sessions` | [SessionSummary](#sessionsummary)[] | 是 | — |

### POST /api/v1/sessions/create

新建会话（首次回复后才落盘）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（长度≥1） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |
| `model` | string（长度≥1） | 否 | — | — |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | — | — |
| `mode` | string（长度≤64，格式 `^[a-z][a-z0-9-]*$`） | 否 | — | — |
| `permissionMode` | "default" \| "auto" \| "full" | 否 | — | — |

**响应类型**：`SessionSummary`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `cwd` | string | 是 | 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区 （`<助理根>/<sessionId>`，见 `health.workspace`）。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |
| `preview` | string | 是 | 首条用户消息，用作列表预览 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | — |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "default" \| "auto" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_question" \| "waiting_plan" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
| `pinnedAt` | string \| null | 是 | 置顶时间；非空表示置顶，排序时置顶项排在组内最前 |
| `lastReadAt` | string \| null | 是 | 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档（软删），列表默认过滤 |

### POST /api/v1/sessions/info

会话详情 + 用量 + 当前目标

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`SessionInfoResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `session` | [SessionSummary](#sessionsummary) | 是 | — |
| `usage` | [UsageTotals](#usagetotals) | 是 | 本会话累计 token 用量（见 stage-10）；未落盘 / 无用量时为零值 |
| `contextUsage` | [ContextUsage](#contextusage) \| null | 是 | 本会话当前上下文占用；判断依据不足时为空——未落盘、模型窗口不可知、压缩后还没出新一轮回答。 |
| `goal` | [GoalView](#goalview) \| null | 是 | 当前会话目标（见 plans/stage-11-goal.md）；未设置或已清除时为空 |

### POST /api/v1/sessions/update

重命名 / 换模型 / 换推理等级 / 换模式 / 换权限档位 / 置顶

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `name` | string（长度≥1） | 否 | — | — |
| `model` | string（长度≥1） | 否 | — | — |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | — | — |
| `mode` | string（长度≤64，格式 `^[a-z][a-z0-9-]*$`） | 否 | — | — |
| `permissionMode` | "default" \| "auto" \| "full" | 否 | — | — |
| `pinned` | boolean | 否 | — | 置顶开关；与名称等覆盖值不同，不改会话文件、也不受生成中限制 |

**响应类型**：`SessionSummary`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `cwd` | string | 是 | 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区 （`<助理根>/<sessionId>`，见 `health.workspace`）。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |
| `preview` | string | 是 | 首条用户消息，用作列表预览 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | — |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "default" \| "auto" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_question" \| "waiting_plan" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
| `pinnedAt` | string \| null | 是 | 置顶时间；非空表示置顶，排序时置顶项排在组内最前 |
| `lastReadAt` | string \| null | 是 | 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档（软删），列表默认过滤 |

### POST /api/v1/sessions/archive

归档会话（软删：从列表隐藏，文件保留）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`SessionArchiveResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `archived` | boolean | 是 | — |

### POST /api/v1/sessions/read

标记会话已读（写上次打开时间）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`SessionSummary`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `cwd` | string | 是 | 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区 （`<助理根>/<sessionId>`，见 `health.workspace`）。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |
| `preview` | string | 是 | 首条用户消息，用作列表预览 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | — |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "default" \| "auto" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_question" \| "waiting_plan" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
| `pinnedAt` | string \| null | 是 | 置顶时间；非空表示置顶，排序时置顶项排在组内最前 |
| `lastReadAt` | string \| null | 是 | 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档（软删），列表默认过滤 |

### POST /api/v1/sessions/fork

从某个条目分叉出新会话

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `fromEntryId` | string（长度≥1） | 否 | — | — |
| `name` | string（长度≥1） | 否 | — | — |

**响应类型**：`SessionSummary`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `cwd` | string | 是 | 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区 （`<助理根>/<sessionId>`，见 `health.workspace`）。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |
| `preview` | string | 是 | 首条用户消息，用作列表预览 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | — |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "default" \| "auto" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_question" \| "waiting_plan" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
| `pinnedAt` | string \| null | 是 | 置顶时间；非空表示置顶，排序时置顶项排在组内最前 |
| `lastReadAt` | string \| null | 是 | 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档（软删），列表默认过滤 |

## 消息（`messages`）

### POST /api/v1/messages/list

会话历史快照（compaction 感知，带接续 seq）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`MessageListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `messages` | [MessageDTO](#messagedto)[] | 是 | — |
| `persisted` | boolean | 是 | 是否已有落盘会话文件 |
| `cwd` | string | 是 | 会话工作目录 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `subagents` | [SubagentSnapshot](#subagentsnapshot)[] | 是 | 仍在进行的子智能体；断流重连后客户端据此重建/收敛嵌套进度 |
| `seq` | number | 是 | 快照序号：本响应已包含到该序号为止的全部事件效果。 客户端订阅后丢弃 seq <= 它的实时帧，可无缝接续。 |
| `liveMessageId` | string | 否 | 投影出的在途消息 id；前端据此把该条标记为生成中 |

### POST /api/v1/messages/prompt

投递一轮生成，返回受理 ack；结果走 /events

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `text` | string | 否 | `` | — |
| `contexts` | object[]（≤32 项） | 否 | — | — |
| `contexts[].path` | string（长度≥1） | 是 | — | — |
| `contexts[].startLine` | integer（>0） | 否 | — | — |
| `contexts[].endLine` | integer（>0） | 否 | — | — |
| `attachments` | object[]（≤8 项） | 否 | — | — |
| `attachments[].id` | string（格式 `^[0-9a-f]{64}$`） | 是 | — | — |
| `behavior` | "follow-up" \| "steer" | 否 | `follow-up` | 生成中再发消息时的投递方式 |

**响应类型**：`PromptAdmittedResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `admitted` | boolean | 是 | — |

### POST /api/v1/messages/edit

编辑一条已发送的用户消息并重发

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `entryId` | string（长度≥1） | 是 | — | — |
| `text` | string（长度≥1） | 是 | — | — |
| `contexts` | object[]（≤32 项） | 否 | — | — |
| `contexts[].path` | string（长度≥1） | 是 | — | — |
| `contexts[].startLine` | integer（>0） | 否 | — | — |
| `contexts[].endLine` | integer（>0） | 否 | — | — |
| `attachments` | object[]（≤8 项） | 否 | — | — |
| `attachments[].id` | string（格式 `^[0-9a-f]{64}$`） | 是 | — | — |

**响应类型**：`PromptAdmittedResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `admitted` | boolean | 是 | — |

### POST /api/v1/messages/interrupt

中断当前生成

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`MessageInterruptResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `aborted` | boolean | 是 | 是否真的中断了一个正在跑的 run |

### POST /api/v1/messages/compact

手动压缩上下文（后台执行，走 compaction_* 事件）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `instructions` | string（长度≥1） | 否 | — | — |

**响应类型**：`PromptAdmittedResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `admitted` | boolean | 是 | — |

### POST /api/v1/messages/ignore-plan

忽略本次计划的决策表单

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`MessageIgnorePlanResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `ignored` | boolean | 是 | 本次是否真的写入了忽略标记；本轮末尾已是标记（重复点击）时为 false |

### POST /api/v1/messages/approve-plan

批准计划（注入开工指令并起一轮）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`MessageApprovePlanResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `admitted` | boolean | 是 | 是否已受理并起了一轮 |

## 交互请求（`interactions`）

### POST /api/v1/interactions/list

列出会话中尚未回答的交互请求

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`InteractionListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `interactions` | [PendingInteraction](#pendinginteraction)[] | 是 | — |

### POST /api/v1/interactions/respond

回答一条挂起的交互请求（按 kind 判别）

**请求参数**

**取值之一（kind = "permission"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `requestId` | string（长度≥1） | 是 | — | — |
| `kind` | "permission" | 是 | — | — |
| `decision` | "allow_once" \| "allow_session" \| "deny" | 是 | — | — |

**取值之一（kind = "question"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `requestId` | string（长度≥1） | 是 | — | — |
| `kind` | "question" | 是 | — | — |
| `answers` | string[][] | 是 | — | — |

**响应类型**：`InteractionRespondResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `requestId` | string | 是 | — |
| `resolved` | boolean | 是 | 是否命中一条待回答请求并已生效；重复回答或请求已失效（本轮中断 / 会话归档）则为 false |

## 文件系统（`fs`）

### POST /api/v1/fs/list

浏览目录条目

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 否 | — | — |
| `q` | string | 否 | — | — |
| `type` | "all" \| "file" \| "directory" | 否 | `all` | — |

**响应类型**：`FsListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `path` | string | 是 | 当前目录的绝对路径 |
| `parent` | string \| null | 是 | 上级目录绝对路径；根目录为 null |
| `entries` | [FsEntry](#fsentry)[] | 是 | 服务端固定排序：目录在前，各自按名称 |

### POST /api/v1/fs/search

按名模糊检索文件（受跳目录 / 深度 / 条数约束）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 否 | — | — |
| `q` | string | 否 | — | — |
| `limit` | integer（>0，≤500） | 否 | `100` | — |

**响应类型**：`FsSearchResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 检索根目录的绝对路径 |
| `entries` | [FsEntry](#fsentry)[] | 是 | 命中条目，服务端固定排序（目录在前，各自按名称） |
| `truncated` | boolean | 是 | 是否因条数上限被截断 |

### POST /api/v1/fs/mkdir

新建目录（单层）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | 待创建目录的绝对路径 |

**响应类型**：`FsMkdirResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 已创建目录的绝对路径 |

### POST /api/v1/fs/read

读取单个文件的内容（文本内联，二进制给 base64）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |
| `maxBytes` | integer（>0，≤8388608） | 否 | — | — |

**响应类型**：`FsReadResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 已归一化的绝对路径 |
| `name` | string | 是 | 文件名字（路径末段），供预览器 tab 直接使用 |
| `size` | number | 是 | 字节数 |
| `updatedAt` | string | 是 | — |
| `kind` | "text" \| "binary" | 是 | — |
| `text` | string | 否 | UTF-8 文本；`kind` 为 `binary` 或超出文本内联上限时缺省 |
| `base64` | string | 否 | base64 字节；`kind` 为 `text` 或超出二进制内联上限时缺省 |
| `truncated` | boolean | 是 | 内容是否因体积上限被截断（二进制超限时为 true 且整块不给） |

## git（`git`）

### POST /api/v1/git/status

仓库状态与分组的变更列表（只读）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |

**响应类型**：`GitStatusResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `isRepo` | boolean | 是 | 目标目录是否在 git 仓库内；false 时其余字段缺省 |
| `repoRoot` | string | 否 | 仓库根绝对路径 |
| `branch` | string | 否 | 当前分支名；分离头指针时为空字符串 |
| `upstream` | string | 否 | 上游跟踪分支（如 `origin/main`），未设置时缺省 |
| `ahead` | number | 否 | 相对上游领先 / 落后的提交数；无上游时缺省 |
| `behind` | number | 否 | — |
| `staged` | [GitFileChange](#gitfilechange)[] | 是 | index 相对 HEAD 的改动 |
| `unstaged` | [GitFileChange](#gitfilechange)[] | 是 | 工作区相对 index 的改动 |
| `untracked` | [GitFileChange](#gitfilechange)[] | 是 | — |
| `conflicted` | [GitFileChange](#gitfilechange)[] | 是 | 存在合并冲突的文件（porcelain 的未合并状态） |
| `truncated` | boolean | 是 | 是否因条数上限被截断 |

### POST /api/v1/git/diff

单文件的结构化 diff（工作区 / index / 某次提交）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |
| `file` | string（长度≥1） | 是 | — | — |
| `source` | "worktree" \| "staged" \| "commit" | 否 | `worktree` | — |
| `commit` | string（长度≥1） | 否 | — | `source` 为 `commit` 时的提交 hash；其他来源忽略 |
| `context` | integer（≥0，≤200） | 否 | `3` | — |

**响应类型**：`GitDiffResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | — |
| `oldPath` | string | 否 | — |
| `status` | "added" \| "modified" \| "deleted" \| "renamed" \| "copied" \| "typeChanged" \| "conflicted" | 是 | — |
| `binary` | boolean | 是 | — |
| `additions` | number | 是 | — |
| `deletions` | number | 是 | — |
| `hunks` | [GitHunk](#githunk)[] | 是 | — |
| `truncated` | boolean | 是 | — |

### POST /api/v1/git/log

提交历史（倒序分页）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |
| `limit` | integer（>0，≤100） | 否 | `30` | — |
| `skip` | integer（≥0） | 否 | `0` | — |

**响应类型**：`GitLogResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `commits` | [GitCommitSummary](#gitcommitsummary)[] | 是 | — |
| `hasMore` | boolean | 是 | 是否还有更早的提交（按 `limit` 判定） |

### POST /api/v1/git/show

单次提交的元信息与改动文件列表

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |
| `hash` | string（长度≥1） | 是 | — | — |

**响应类型**：`GitShowResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `commit` | [GitCommitDetail](#gitcommitdetail) | 是 | — |
| `files` | [GitFileChange](#gitfilechange)[] | 是 | 该提交改动的文件；单个文件的 diff 由客户端按需取 |
| `truncated` | boolean | 是 | 文件列表是否因条数上限被截断 |

## MCP 服务器（`mcp`）

### POST /api/v1/mcp/list

列出已配置的 MCP 服务器

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`McpListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `servers` | [McpServerView](#mcpserverview)[] | 是 | — |
| `configPath` | string | 是 | 配置文件绝对路径，供设置页展示与排查 |
| `errors` | string[] | 是 | 读盘或解析失败的原因（坏 JSON、字段不合法）；空数组表示正常 |

### POST /api/v1/mcp/upsert

按 name 覆盖写入 MCP 服务器

**请求参数**

**取值之一（type = "stdio"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[A-Za-z0-9][A-Za-z0-9._-]*$`） | 是 | — | — |
| `enabled` | boolean | 否 | `true` | — |
| `exposure` | "codemode" \| "deferred" \| "direct" \| "hidden" | 否 | `codemode` | — |
| `timeout` | integer（>0） | 否 | — | 单请求超时（秒），省略即用 pi 默认 60 |
| `type` | "stdio" | 是 | — | — |
| `command` | string（长度≥1） | 是 | — | — |
| `args` | string[] | 否 | — | — |
| `env` | Record<string, string> | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | 相对路径按会话工作目录解析 |

**取值之一（type = "http"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[A-Za-z0-9][A-Za-z0-9._-]*$`） | 是 | — | — |
| `enabled` | boolean | 否 | `true` | — |
| `exposure` | "codemode" \| "deferred" \| "direct" \| "hidden" | 否 | `codemode` | — |
| `timeout` | integer（>0） | 否 | — | 单请求超时（秒），省略即用 pi 默认 60 |
| `type` | "http" | 是 | — | — |
| `url` | string（长度≥1） | 是 | — | — |
| `headers` | Record<string, string> | 否 | — | — |

**响应类型**：`McpWriteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `server` | [McpServerView](#mcpserverview) | 是 | — |
| `configPath` | string | 是 | — |

### POST /api/v1/mcp/delete

按 name 删除 MCP 服务器

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[A-Za-z0-9][A-Za-z0-9._-]*$`） | 是 | — | — |

**响应类型**：`McpDeleteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `removed` | boolean | 是 | 是否命中并删除了条目；目标不存在时为 false |
| `configPath` | string | 是 | — |

## 角色（`agents`）

### POST /api/v1/agents/list

列出可选的 primary / subagent 角色

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |

**响应类型**：`AgentsListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `primary` | [AgentView](#agentview)[] | 是 | 主会话角色：内置 build / plan / ask 与自定义 primary |
| `subagents` | [AgentView](#agentview)[] | 是 | 子角色：内置 general / explore 与自定义 subagent |

## 附件（`attachments`）

### POST /api/v1/attachments

上传附件（请求体为原始字节，文件名走 ?name=；图片归一化后入库）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`AttachmentUploadResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 内容 id：归一化（图片）或原始字节（其它）的 sha256，64 位小写 hex |
| `mimeType` | string | 是 | — |
| `name` | string \| null | 是 | 原始文件名；未提供时为 null |
| `size` | number | 是 | 入库字节数（图片是归一化之后的大小） |
| `kind` | "file" \| "image" | 是 | 图片走 vision，其余只存与引用 |

### GET /api/v1/attachments/:id

按 id 返回附件原始字节（非 JSON，不走封套）

**请求参数**

无参数

**响应**

原始字节（非 JSON，不走封套）；`Content-Type` 取自附件自身的 mimeType，带 `Cache-Control: immutable` 与 `ETag`。

## commands（`commands`）

### POST /api/v1/commands/list

列出可用的提示词命令与技能

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |

**响应类型**：`CommandsListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `prompts` | [PromptCommandView](#promptcommandview)[] | 是 | — |
| `skills` | [SkillCommandView](#skillcommandview)[] | 是 | — |

## 目标模式（`goals`）

### POST /api/v1/goals/set

设定 / 替换当前会话目标

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `objective` | string（长度 1–4000） | 是 | — | — |
| `tokenBudget` | integer（>0） | 否 | — | — |

**响应类型**：`GoalResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `goal` | [GoalView](#goalview) \| null | 是 | 当前目标；已清除或从未设置时为空 |

### POST /api/v1/goals/status

查看当前会话目标状态

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`GoalResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `goal` | [GoalView](#goalview) \| null | 是 | 当前目标；已清除或从未设置时为空 |

### POST /api/v1/goals/pause

暂停目标自动续跑

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`GoalResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `goal` | [GoalView](#goalview) \| null | 是 | 当前目标；已清除或从未设置时为空 |

### POST /api/v1/goals/resume

恢复目标自动续跑

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`GoalResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `goal` | [GoalView](#goalview) \| null | 是 | 当前目标；已清除或从未设置时为空 |

### POST /api/v1/goals/clear

清除当前会话目标

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`GoalResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `goal` | [GoalView](#goalview) \| null | 是 | 当前目标；已清除或从未设置时为空 |

## 使用统计（`stats`）

### POST /api/v1/stats/summary

全局 token 用量统计（按模型 / 会话聚合）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `days` | integer（>0，≤3650） | 否 | — | — |

**响应类型**：`StatsSummaryResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | [UsageTotals](#usagetotals) | 是 | — |
| `toolCalls` | number | 是 | assistant 消息里的工具调用总数 |
| `byModel` | [ModelUsage](#modelusage)[] | 是 | — |
| `bySession` | [SessionUsageEntry](#sessionusageentry)[] | 是 | — |
| `daily` | [UsageDayBucket](#usagedaybucket)[] | 是 | 区间内的逐日用量；与 `total` 同口径，求和等于 `total.totalTokens` |
| `weekly` | [UsageWeekBucket](#usageweekbucket)[] | 是 | 区间内的逐周用量，由逐日结果按周一归并 |
| `streak` | [UsageStreak](#usagestreak) | 是 | 活跃度与连续天数（全量历史） |
| `peak` | [UsagePeakDay](#usagepeakday) \| null | 是 | 区间内的峰值日；区间内没有用量时为 null |
| `longestSessionMs` | number | 是 | 区间内「单会话最长聊天时长」（毫秒）：会话内相邻调用间隔不超过 30 分钟算同一段， 各段时长累加即该会话的聊天时长，再取会话间的最大值；单点会话为 0。 |

## 事件流

`POST /api/v1/events` 返回 `text/event-stream`，**不套封套**：SSE 事件名固定 `message`，
真正的类型在 `data` 的 JSON 里。心跳为 `: heartbeat` 注释行；订阅者队列满时服务端直接断流，
由客户端重连 + `messages/list` 快照补齐。

**事件帧结构**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "message_start" \| "text_delta" \| "thinking_delta" \| "tool_call" \| "tool_start" \| "tool_update" \| "tool_end" \| "message_end" \| "queue_update" \| "compaction_start" \| "compaction_end" \| "agent_settled" \| "transcript_reset" \| "interaction_request" \| "interaction_resolved" \| "subagent_start" \| "subagent_end" \| "goal_update" \| "session_created" \| "session_updated" \| "session_archived" | 是 | — |
| `sessionId` | string | 是 | — |
| `seq` | number | 是 | — |
| `data` | unknown | 是 | — |

**控制帧结构**

**取值之一（type = "server.connected"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "server.connected" | 是 | — |

**取值之一（type = "error"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "error" | 是 | — |
| `sessionId` | string | 否 | — |
| `code` | string | 是 | — |
| `message` | string | 是 | 中文兜底文案；客户端按 `code` 查 errorMessageKeys 渲染 |
| `params` | Record<string, string> | 否 | 渲染文案所需的插值值 |

**取值之一（type = "config_changed"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "config_changed" | 是 | — |
| `config` | [ConfigSnapshot](#configsnapshot) | 是 | — |

**取值之一（type = "mcp_changed"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "mcp_changed" | 是 | — |
| `mcp` | [McpListResponse](#mcplistresponse) | 是 | — |

**事件名（`type`）**

- `message_start`
- `text_delta`
- `thinking_delta`
- `tool_call`
- `tool_start`
- `tool_update`
- `tool_end`
- `message_end`
- `queue_update`
- `compaction_start`
- `compaction_end`
- `agent_settled`
- `transcript_reset`
- `interaction_request`
- `interaction_resolved`
- `subagent_start`
- `subagent_end`
- `goal_update`
- `session_created`
- `session_updated`
- `session_archived`

各事件 `data` 的载荷说明见 [README「全局事件流」](../README.md#全局事件流)。

## 公共类型

以下类型被多个接口复用，字段说明同响应表。

### AuthSessionView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `createdAt` | string | 是 | 签发时间（ISO 8601 UTC） |
| `expiresAt` | string | 是 | 过期时间（ISO 8601 UTC） |
| `lastSeenAt` | string | 是 | 最近一次使用时间（ISO 8601 UTC） |
| `label` | string | 是 | 会话标签（设备名 / 备注） |

### CatalogProvider

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | — |
| `baseUrl` | string \| null | 是 | 内置目录里可能没有固定端点（这类 provider 不参与一键接入） |
| `api` | string | 是 | — |
| `source` | "custom" \| "builtin" | 是 | — |
| `available` | boolean | 是 | 该 provider 是否已配置可用的鉴权 |
| `authSource` | string \| null | 是 | 鉴权来源：stored / runtime / environment / fallback；未配置时为 null |
| `authName` | string | 是 | 鉴权说明文案，如 "DeepSeek API key" |
| `customized` | boolean | 是 | 用户是否覆盖了模型清单（覆盖后该 provider 不再跟随内置目录更新） |
| `models` | [CatalogModel](#catalogmodel)[] | 是 | — |

### ConfigView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `defaultModel` | string \| null | 是 | — |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | — |
| `providers` | [ProviderConfigView](#providerconfigview)[] | 是 | — |
| `websearch` | [WebsearchView](#websearchview) | 是 | — |
| `memory` | [MemoryView](#memoryview) | 是 | — |

### RuntimeStatus

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 是否已有可用模型 |
| `defaultModel` | string \| null | 是 | 实际生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | 生效的 thinking 档位 |
| `error` | string \| null | 是 | 未就绪时的原因说明 |

### ProviderModelSuggestion

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | 上游给出的展示名，没给则回落为 id |
| `reasoning` | boolean | 是 | 是否支持思考（推断） |
| `vision` | boolean | 是 | 是否接受图片输入（推断） |
| `contextWindow` | number | 是 | 上下文窗口（推断） |
| `maxTokens` | number | 是 | 单次输出上限（推断） |
| `capabilitySource` | "default" \| "configured" \| "upstream" \| "catalog" \| "heuristic" | 是 | 上述能力的取值来源 |
| `configured` | boolean | 是 | 是否已存在于该 provider 的配置里（按 id 比对） |

### SessionSummary

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `cwd` | string | 是 | 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区 （`<助理根>/<sessionId>`，见 `health.workspace`）。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |
| `preview` | string | 是 | 首条用户消息，用作列表预览 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 是 | — |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "default" \| "auto" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空（见 `plans/stage-7c-subagents.md`） |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_question" \| "waiting_plan" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
| `pinnedAt` | string \| null | 是 | 置顶时间；非空表示置顶，排序时置顶项排在组内最前 |
| `lastReadAt` | string \| null | 是 | 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档（软删），列表默认过滤 |

### UsageTotals

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `inputTokens` | number | 是 | — |
| `outputTokens` | number | 是 | — |
| `cacheReadTokens` | number | 是 | — |
| `cacheWriteTokens` | number | 是 | — |
| `totalTokens` | number | 是 | — |

### ContextUsage

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tokens` | number | 是 | 上下文里的 token 数 |
| `contextWindow` | number | 是 | 该会话当前生效模型的上下文窗口 |
| `estimated` | boolean | 是 | 是否为估算值：压缩会重写上下文，而压缩点之前那次回答的用量反映的是压缩前的规模， 因此压缩完成到新一轮回答之间没有可信的实测值，只能用压缩结果里的估算规模顶替。 |
| `budget` | number \| null | 否 | 本次会话的压缩触发阈值（token）：到达它就自动压缩（见 `harness/budget`）。 与窗口分开给出，因为触发点按「有效预算」算，不等于模型声明的窗口。 |
| `lastCompaction` | object \| null | 否 | 最近一次自动压缩：原因与实际发生时间；没发生过为空 |

### GoalView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `objective` | string | 是 | — |
| `status` | "active" \| "paused" \| "completed" | 是 | — |
| `cause` | "error" \| "limit" \| "mode" \| "user" \| "interrupted" \| "no_progress" \| "budget" \| null | 是 | 暂停原因；`active` / `completed` 时为空 |
| `turns` | number | 是 | 已自动续跑的轮数（不含用户触发的那轮） |
| `tokenBudget` | number \| null | 是 | token 预算；为空表示不限 |
| `tokensUsed` | number | 是 | 目标开始后本会话累计消耗的 token（不含校验调用） |
| `startedAt` | string | 是 | 目标设定时间（ISO 8601），也是用量统计的起点 |
| `updatedAt` | string | 是 | — |
| `verification` | [GoalVerification](#goalverification) \| null | 是 | 最近一次校验结果；还没校验过时为空 |

### MessageDTO

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `role` | "custom" \| "user" \| "assistant" \| "tool" \| "summary" | 是 | — |
| `blocks` | [MessageBlock](#messageblock)[] | 是 | — |
| `model` | string | 否 | assistant 专用：产生该回复的模型 id |
| `provider` | string | 否 | assistant 专用：模型所属 provider id |
| `thinkingLevel` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | assistant 专用：产生该回复时生效的推理等级 |
| `toolCallId` | string | 否 | tool 专用：与 toolCall block 的 id 对应，便于前端精确合并 |
| `toolName` | string | 否 | tool 专用 |
| `questionAnswers` | string[][] | 否 | tool 专用：`question` 的结构化答复，与调用入参里的 `questions` 同序（每项可多值） |
| `customType` | string | 否 | custom 专用：扩展条目的来源标识，界面据此区分界面标记（如忽略计划的标记）与普通扩展消息 |
| `permissionDecision` | [PermissionRecord](#permissionrecord) | 否 | custom 专用：权限审批记录；只有该类型的扩展条目会带上 |
| `compactionRecord` | [CompactionRecord](#compactionrecord) | 否 | custom 专用：压缩记录；只有该类型的扩展条目会带上 |
| `goalRecord` | [GoalRecord](#goalrecord) | 否 | custom 专用：目标记录；只有该类型的扩展条目会带上（界面展示 `completed` 那一条） |
| `modeChange` | [ModeRecord](#moderecord) | 否 | 模式 / 权限档位的变更（`MODE_RECORD_CUSTOM_TYPE` 条目） |
| `goalPrompt` | [GoalPromptDetails](#goalpromptdetails) | 否 | custom 专用：目标指令的来源（启动 / 续跑 / 恢复）；只有目标注入的条目会带上 |
| `isError` | boolean | 否 | — |
| `createdAt` | string | 否 | 消息产生时间（ISO 8601 UTC）；时间不可用时缺省 |
| `completedAt` | string | 否 | assistant 专用：该条回复生成结束、写入会话记录的时刻（ISO 8601 UTC）。 pi 的 `message.timestamp` 是开始生成的时刻，回复的真实耗时要靠它与 createdAt 相减得到。 |

### SubagentSnapshot

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `toolCallId` | string | 是 | 父会话里发起这次委派的工具调用 id |
| `sessionId` | string | 是 | 子会话 id |
| `description` | string | 是 | 任务简称（服务端已按长度截断） |

### PendingInteraction

**取值之一（kind = "permission"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `requestId` | string | 是 | — |
| `kind` | "permission" | 是 | — |
| `sessionId` | string | 是 | — |
| `tool` | string | 是 | 触发审批的工具名，如 `read` / `bash` |
| `subject` | string | 是 | 规则匹配到的对象：路径 / 命令 / URL，展示给用户判断 |
| `scope` | string | 是 | 本次授权覆盖的范围：规则类 ask 是规则串，越界检查是父目录通配 |
| `sourceSessionId` | string | 否 | 发起请求的子会话 id 与描述；主会话自身发起时为空（来源标注用） |
| `sourceDescription` | string | 否 | — |
| `createdAt` | string | 是 | — |

**取值之一（kind = "question"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `requestId` | string | 是 | — |
| `kind` | "question" | 是 | — |
| `sessionId` | string | 是 | — |
| `questions` | [QuestionItem](#questionitem)[] | 是 | — |
| `sourceSessionId` | string | 否 | 发起提问的子会话 id 与描述；主会话自身发起时为空（来源标注用） |
| `sourceDescription` | string | 否 | — |
| `createdAt` | string | 是 | — |

### FsEntry

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | — |
| `path` | string | 是 | 绝对路径 |
| `type` | "file" \| "directory" | 是 | — |
| `size` | number | 是 | 字节数；目录为 0 |
| `updatedAt` | string | 是 | — |

### GitFileChange

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | — |
| `oldPath` | string | 否 | — |
| `status` | "added" \| "modified" \| "deleted" \| "renamed" \| "copied" \| "typeChanged" \| "conflicted" | 是 | — |
| `additions` | number \| null | 是 | 新增行数；未跟踪、重命名与二进制文件无法统计时为 null |
| `deletions` | number \| null | 是 | 删除行数；无法统计时为 null |

### GitHunk

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `header` | string | 是 | — |
| `lines` | [GitDiffLine](#gitdiffline)[] | 是 | — |

### GitCommitSummary

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `hash` | string | 是 | — |
| `shortHash` | string | 是 | — |
| `subject` | string | 是 | — |
| `authorName` | string | 是 | — |
| `authoredAt` | string | 是 | 提交时刻（ISO 8601，带提交本身的时区偏移） |
| `refs` | string[] | 是 | 指向该提交的分支 / 标签装饰；无则空数组 |

### GitCommitDetail

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `hash` | string | 是 | — |
| `shortHash` | string | 是 | — |
| `subject` | string | 是 | — |
| `authorName` | string | 是 | — |
| `authoredAt` | string | 是 | 提交时刻（ISO 8601，带提交本身的时区偏移） |
| `refs` | string[] | 是 | 指向该提交的分支 / 标签装饰；无则空数组 |
| `body` | string | 是 | 提交正文（不含标题行）；无正文时为空字符串 |
| `parents` | string[] | 是 | 父提交 hash；首次提交为空数组，合并提交有多项 |

### McpServerView

**取值之一（type = "stdio"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | — |
| `enabled` | boolean | 是 | — |
| `exposure` | "codemode" \| "deferred" \| "direct" \| "hidden" | 是 | — |
| `type` | "stdio" | 是 | — |
| `command` | string | 是 | — |
| `timeout` | number | 否 | 单请求超时（秒），省略即用 pi 默认 60 |
| `args` | string[] | 否 | — |
| `env` | Record<string, string> | 否 | — |
| `cwd` | string | 否 | 相对路径按会话工作目录解析 |

**取值之一（type = "http"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | — |
| `enabled` | boolean | 是 | — |
| `exposure` | "codemode" \| "deferred" \| "direct" \| "hidden" | 是 | — |
| `type` | "http" | 是 | — |
| `url` | string | 是 | — |
| `timeout` | number | 否 | — |
| `headers` | Record<string, string> | 否 | — |

### AgentView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `slug` | string | 是 | 角色 slug；主会话用它作 `mode`，子会话用它作 `agent` |
| `label` | string | 是 | 展示名 |
| `description` | string | 是 | 角色说明；供界面展示与模型挑选 |
| `kind` | "primary" \| "subagent" | 是 | — |
| `source` | "builtin" \| "project" \| "global" | 是 | — |
| `hidden` | boolean | 否 | 是否对选择器隐藏（`hidden: true`）；隐藏项仍可按名调用 |

### PromptCommandView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 命令名；调用时序列化为 `/name` |
| `description` | string | 是 | 一句话说明，供菜单展示 |
| `argumentHint` | string | 否 | 参数提示，如 `[focus]`；无参数时缺省 |
| `source` | "builtin" \| "project" \| "global" \| "agents-project" \| "agents-user" | 是 | 来源；同名时数组顺序靠前者胜 |

### SkillCommandView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 技能名；显式调用序列化为 `/skill:name`，模型也可按描述自动选用 |
| `description` | string | 是 | — |
| `source` | "builtin" \| "project" \| "global" \| "agents-project" \| "agents-user" | 是 | — |

### ModelUsage

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider` | string | 是 | — |
| `model` | string | 是 | — |
| `totals` | [UsageTotals](#usagetotals) | 是 | — |

### SessionUsageEntry

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `kind` | "primary" \| "subagent" \| "forked" | 是 | — |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档，统计里仍计入，但界面不应再打开该会话 |
| `totals` | [UsageTotals](#usagetotals) | 是 | — |

### UsageDayBucket

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `totals` | [UsageTotals](#usagetotals) | 是 | — |
| `messages` | number | 是 | 该桶内的调用次数（有 usage 的条目数），界面上记为「轮消息」；工具次数不计入 |
| `date` | string | 是 | — |

### UsageWeekBucket

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `totals` | [UsageTotals](#usagetotals) | 是 | — |
| `messages` | number | 是 | 该桶内的调用次数（有 usage 的条目数），界面上记为「轮消息」；工具次数不计入 |
| `weekStart` | string | 是 | — |

### UsageStreak

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `current` | number | 是 | 当前连续天数：最新活跃日为今天或昨天时从该日往回数，否则为 0 |
| `longest` | number | 是 | 历史最长连续天数 |
| `activeDays` | number | 是 | 有活动（至少一个用量点）的天数 |

### UsagePeakDay

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `date` | string | 是 | — |
| `totalTokens` | number | 是 | — |

### ConfigSnapshot

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `config` | [ConfigView](#configview) | 是 | — |
| `status` | [RuntimeStatus](#runtimestatus) | 是 | — |

### McpListResponse

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `servers` | [McpServerView](#mcpserverview)[] | 是 | — |
| `configPath` | string | 是 | 配置文件绝对路径，供设置页展示与排查 |
| `errors` | string[] | 是 | 读盘或解析失败的原因（坏 JSON、字段不合法）；空数组表示正常 |

### CatalogModel

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | — |
| `reasoning` | boolean | 是 | — |
| `vision` | boolean | 是 | 是否接受图片输入（视觉能力） |
| `contextWindow` | number | 否 | 仅已接入的供应商提供 |
| `maxTokens` | number | 否 | 仅已接入的供应商提供 |

### ProviderConfigView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | — |
| `baseUrl` | string | 否 | 留空表示继承 pi 内置目录的同名 provider |
| `api` | "openai-completions" \| "openai-responses" \| "anthropic-messages" \| "google-generative-ai" \| "mistral-conversations" \| "azure-openai-responses" \| "openai-codex-responses" \| "bedrock-converse-stream" \| "google-vertex" \| "pi-messages" | 是 | — |
| `apiKeyMasked` | string | 是 | 脱敏后的 key，仅用于回显「已保存」 |
| `models` | object[] | 否 | 留空表示模型清单继承 pi 内置目录 |

### WebsearchView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider` | "tavily" \| "searxng" \| "brave" | 是 | — |
| `apiKeyMasked` | string | 是 | — |
| `baseUrl` | string | 是 | 自建 SearXNG 的实例地址；其他 provider 恒为空串 |
| `configured` | boolean | 是 | 该 provider 的前置条件是否齐备（key 或实例地址）；决定 websearch 工具是否可用 |

### MemoryView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | 是 | — |

### GoalVerification

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `achieved` | boolean | 是 | — |
| `reason` | string | 是 | — |
| `nextStep` | string | 是 | — |
| `at` | string | 是 | 校验时间（ISO 8601） |

### MessageBlock

**取值之一（type = "text"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "text" | 是 | — |
| `text` | string | 是 | — |

**取值之一（type = "thinking"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "thinking" | 是 | — |
| `text` | string | 是 | — |

**取值之一（type = "toolCall"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "toolCall" | 是 | — |
| `id` | string | 是 | — |
| `name` | string | 是 | — |
| `args` | unknown | 是 | — |

**取值之一（type = "image"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "image" | 是 | — |
| `id` | string | 是 | — |
| `mimeType` | string | 是 | — |
| `url` | string | 是 | — |

**取值之一（type = "file"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "file" | 是 | — |
| `id` | string | 是 | — |
| `mimeType` | string | 是 | — |
| `name` | string | 是 | — |
| `size` | number | 是 | — |
| `url` | string | 是 | — |

### PermissionRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `tool` | string | 是 | 触发审批的工具名，如 `read` / `bash` |
| `subject` | string | 是 | 规则匹配到的对象：路径 / 命令 / URL |
| `scope` | string | 是 | 本次授权覆盖的范围：规则类 ask 是规则串，越界检查是父目录通配 |
| `decision` | "allow_once" \| "allow_session" \| "deny" | 是 | 用户的决定 |
| `sourceSessionId` | string | 否 | 发起请求的子会话 id；主会话自身发起时为空（与弹窗一致地标注来源） |
| `sourceDescription` | string | 否 | 发起请求的子会话描述 |

### CompactionRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `reason` | "manual" \| "threshold" \| "overflow" | 是 | — |
| `outcome` | "done" \| "skipped" \| "failed" | 是 | — |
| `tokensBefore` | number | 否 | 压缩前的上下文占用（token） |
| `tokensAfter` | number | 否 | 压缩后的估算占用（token）；pi 拿不到时省略 |
| `keptFrom` | string | 否 | 保留区间的起点条目 id（压缩后模型还看得到的部分从这里开始） |
| `skip` | "too_small" \| "already_compacted" | 否 | `skipped` 专用：正常拒绝的原因 |
| `error` | string | 否 | `failed` 专用：pi 给的原始失败原因 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### GoalRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event` | "set" \| "completed" \| "pause" \| "resume" \| "clear" \| "verdict" | 是 | — |
| `status` | "active" \| "paused" \| "completed" | 否 | 本次事件后的状态（`clear` 时缺省） |
| `cause` | "error" \| "limit" \| "mode" \| "user" \| "interrupted" \| "no_progress" \| "budget" | 否 | `pause` 专用：暂停原因 |
| `turns` | number | 否 | 目标激活后累计的轮数 |
| `verdict` | object | 否 | 校验结论；`verdict` 与 `completed` 都带 |
| `tokensUsed` | number | 否 | 本轮的用量累计（token）；存储态只给当前值，历史需要自己带 |
| `objective` | string | 否 | 目标正文；只在 `set` 时带，其余从存储态能看出 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### ModeRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | string | 否 | 变更后的模式（编码 / 计划 / 提问）；只改权限档位时没有 |
| `permissionMode` | string | 否 | 变更后的权限档位 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### GoalPromptDetails

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "resume" \| "kickoff" \| "continuation" | 是 | — |
| `turn` | number | 否 | 续跑专用：这是目标激活后的第几轮 |

### QuestionItem

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `header` | string | 是 | — |
| `question` | string | 是 | — |
| `options` | [QuestionOption](#questionoption)[] | 是 | — |
| `multiple` | boolean | 否 | — |

### GitDiffLine

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "ctx" \| "add" \| "del" | 是 | — |
| `oldLine` | number \| null | 是 | — |
| `newLine` | number \| null | 是 | — |
| `text` | string | 是 | 行内容（不含前导的 +/-/空格） |

### QuestionOption

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string | 是 | — |
| `description` | string | 是 | — |
