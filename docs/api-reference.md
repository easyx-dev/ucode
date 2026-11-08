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
| GET | `/api/v1/hub/status` | 中继接入状态（地址 / 账号 / 设备标识与隧道运行态） |
| POST | `/api/v1/hub/login` | 登录中继并把本机登记为设备（成功即重建隧道，返回登录后的状态） |
| POST | `/api/v1/hub/logout` | 退出中继：清掉本机设备绑定与登录凭证、断开隧道，并尽力吊销中继侧设备（保留地址） |
| POST | `/api/v1/hub/provider` | 把中继的模型端点写成本机 provider（固定 id relay，模型清单现拉中继的 /v1/models） |
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
| POST | `/api/v1/projects/list` | 项目列表（按 cwd 归口的展示名与最近的会话参数） |
| POST | `/api/v1/projects/update` | 重命名项目（name 传 null 即清空，界面回落目录末段） |
| POST | `/api/v1/projects/reorder` | 重排项目（paths 是侧栏从上到下的目录次序） |
| POST | `/api/v1/memory/list` | 列出有记忆的项目与条目（只读） |
| POST | `/api/v1/memory/read` | 读一条记忆的正文（按记忆目录名 + 事实文件名寻址） |
| POST | `/api/v1/memory/update` | 改一条记忆的标题与正文（文件名不变） |
| POST | `/api/v1/memory/delete` | 删一条记忆（文件与索引行一起删） |
| POST | `/api/v1/messages/list` | 会话历史快照（compaction 感知，带接续 seq） |
| POST | `/api/v1/messages/services` | 会话的后台服务清单（响应前重探一次，供活动面板用） |
| POST | `/api/v1/messages/prompt` | 投递一轮生成，返回受理 ack；结果走 /events |
| POST | `/api/v1/messages/edit` | 编辑一条已发送的用户消息并重发 |
| POST | `/api/v1/messages/interrupt` | 中断当前生成 |
| POST | `/api/v1/messages/compact` | 手动压缩上下文（后台执行，走 compaction_* 事件） |
| POST | `/api/v1/messages/dequeue` | 撤回排队中的输入（整清，返回撤掉的条数） |
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
| POST | `/api/v1/git/contents` | 单文件对比两侧的原文（展开未变更区域用） |
| POST | `/api/v1/git/log` | 提交历史（倒序分页） |
| POST | `/api/v1/git/show` | 单次提交的元信息与改动文件列表 |
| POST | `/api/v1/mcp/list` | 列出已配置的 MCP 服务器 |
| POST | `/api/v1/mcp/upsert` | 按 name 覆盖写入 MCP 服务器 |
| POST | `/api/v1/mcp/delete` | 按 name 删除 MCP 服务器 |
| POST | `/api/v1/plugins/list` | 列出已登记的插件、组件摘要与诊断 |
| POST | `/api/v1/plugins/create` | 按来源（本地目录 / url / npm / github / git）安装并登记插件 |
| POST | `/api/v1/plugins/update` | 启停插件或写入 userConfig 的值 |
| POST | `/api/v1/plugins/delete` | 移除插件登记（purge 时一并清理缓存与插件数据） |
| POST | `/api/v1/plugins/refresh` | 按来源重读插件清单并推进代次 |
| POST | `/api/v1/marketplace/list` | 列出已登记的市场与刷新状态 |
| POST | `/api/v1/marketplace/info` | 市场内插件列表（读上一次刷新的缓存，不触发网络） |
| POST | `/api/v1/marketplace/create` | 登记市场来源 |
| POST | `/api/v1/marketplace/delete` | 移除市场登记（下挂插件只失去来源，内容不删） |
| POST | `/api/v1/marketplace/refresh` | 刷新市场清单（本地目录 / url / github / git） |
| POST | `/api/v1/agents/list` | 列出可选的 primary / subagent 角色 |
| POST | `/api/v1/assets/list` | 列出角色 / 技能 / 命令三类资产（含只读来源、被覆盖关系与解析失败的条目） |
| POST | `/api/v1/assets/read` | 读一条资产的详情（frontmatter 字段 + 正文 + 保留的额外行） |
| POST | `/api/v1/assets/save` | 新建或覆盖一条资产（落点由 kind + scope 决定，不接受路径） |
| POST | `/api/v1/assets/delete` | 删除一条资产（技能连目录一起删），只读来源拒绝 |
| POST | `/api/v1/attachments` | 上传附件（请求体为原始字节，文件名走 ?name=；图片归一化后入库） |
| GET | `/api/v1/attachments/:id` | 按 id 返回附件原始字节（非 JSON，不走封套） |
| POST | `/api/v1/commands/list` | 列出可用的提示词命令与技能 |
| POST | `/api/v1/goals/set` | 设定 / 替换当前会话目标 |
| POST | `/api/v1/goals/status` | 查看当前会话目标状态 |
| POST | `/api/v1/goals/budget` | 只改目标的 token 预算（不动轮数与校验结果） |
| POST | `/api/v1/goals/pause` | 暂停目标自动续跑 |
| POST | `/api/v1/goals/resume` | 恢复目标自动续跑 |
| POST | `/api/v1/goals/clear` | 清除当前会话目标 |
| POST | `/api/v1/stats/summary` | 全局 token 用量统计（按模型 / 会话聚合） |
| POST | `/api/v1/design/snapshot` | 读设计稿的结构摘要（页面表、节点摘要、画布选中集、引用前缀） |
| POST | `/api/v1/design/render` | 取整页 drawing（`revision` 与文档一致时 `svg` 为 null，画布据此跳过重绘） |
| POST | `/api/v1/design/select` | 写回画布选中集（不存在的 id 会被过滤） |
| POST | `/api/v1/design/files` | 列出项目里的设计稿文件（标出本会话当前在改的那份） |
| POST | `/api/v1/design/node` | 读一个设计节点的完整属性（属性浮窗） |
| POST | `/api/v1/design/doc` | 文档级动作：立刻落盘 / 清空重来 / 换一页 |
| POST | `/api/v1/browser/list` | 列出浏览器 profile（占用、最后使用时间、是否使用中） |
| POST | `/api/v1/browser/delete` | 删除浏览器 profile（使用中的跳过，传全集即清空） |
| POST | `/api/v1/browser/desktop` | 桌面端浏览器通道的当前状态（有哪些标签、当前在看哪一个） |
| POST | `/api/v1/browser/desktop/ticket` | 签一张桌面端浏览器通道的一次性握手票 |
| GET | `/api/v1/browser/desktop` | 桌面端浏览器通道（WebSocket：上报标签集合与激活项，agent 驱动当前激活的那个） |
| POST | `/api/v1/terminal/create` | 起一个终端（按会话 id 或工作目录归口） |
| POST | `/api/v1/terminal/list` | 列出某工作目录下的终端（客户端据此恢复标签） |
| POST | `/api/v1/terminal/resize` | 改终端尺寸（前端按实测值上报） |
| POST | `/api/v1/terminal/close` | 结束终端（杀进程并摘除条目） |
| POST | `/api/v1/terminal/ticket` | 签一张输出流的一次性握手票 |
| GET | `/api/v1/terminal/stream` | 单终端输出流（WebSocket：先重放最近输出，再实时） |

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
| `instanceId` | string | 是 | 本次启动的实例标识：CLI 据此核对端口上的服务是不是注册文件描述的那个进程 |

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

## 中继（`hub`）

### GET /api/v1/hub/status

中继接入状态（地址 / 账号 / 设备标识与隧道运行态）

**请求参数**

无参数

**响应类型**：`HubStatusResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 地址与设备令牌齐备，具备连隧道的条件 |
| `url` | string \| null | 是 | 中继服务地址（含部署预置的缺省值）；未配置为 null |
| `username` | string \| null | 是 | 当前登录的中继账号；未登录为 null |
| `deviceId` | string \| null | 是 | 本机在中继上的设备标识；未登记为 null |
| `deviceName` | string \| null | 是 | 登记设备时用的本机名（主机名） |
| `running` | boolean | 是 | 当前是否持有隧道连接 |
| `runtime` | [HubRuntimeView](#hubruntimeview) | 是 | 隧道的连接态与最近一次失败原因 |

### POST /api/v1/hub/login

登录中继并把本机登记为设备（成功即重建隧道，返回登录后的状态）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `url` | string | 否 | — | 中继服务地址；省略时用本机已保存的地址（都没有则报「未配置中继地址」） |
| `username` | string（长度 1–100） | 是 | — | 中继上的登录账号（管理端或客户端账号都认） |
| `password` | string（长度 1–200） | 是 | — | — |

**响应类型**：`HubLoginResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 地址与设备令牌齐备，具备连隧道的条件 |
| `url` | string \| null | 是 | 中继服务地址（含部署预置的缺省值）；未配置为 null |
| `username` | string \| null | 是 | 当前登录的中继账号；未登录为 null |
| `deviceId` | string \| null | 是 | 本机在中继上的设备标识；未登记为 null |
| `deviceName` | string \| null | 是 | 登记设备时用的本机名（主机名） |
| `running` | boolean | 是 | 当前是否持有隧道连接 |
| `runtime` | [HubRuntimeView](#hubruntimeview) | 是 | 隧道的连接态与最近一次失败原因 |

### POST /api/v1/hub/logout

退出中继：清掉本机设备绑定与登录凭证、断开隧道，并尽力吊销中继侧设备（保留地址）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`HubLogoutResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 地址与设备令牌齐备，具备连隧道的条件 |
| `url` | string \| null | 是 | 中继服务地址（含部署预置的缺省值）；未配置为 null |
| `username` | string \| null | 是 | 当前登录的中继账号；未登录为 null |
| `deviceId` | string \| null | 是 | 本机在中继上的设备标识；未登记为 null |
| `deviceName` | string \| null | 是 | 登记设备时用的本机名（主机名） |
| `running` | boolean | 是 | 当前是否持有隧道连接 |
| `runtime` | [HubRuntimeView](#hubruntimeview) | 是 | 隧道的连接态与最近一次失败原因 |

### POST /api/v1/hub/provider

把中继的模型端点写成本机 provider（固定 id relay，模型清单现拉中继的 /v1/models）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`HubProviderResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `providerId` | string | 是 | 写入的 provider id（固定 `relay`） |
| `baseUrl` | string | 是 | 写入的端点根地址：`<中继地址>/v1`，对话与模型清单都在它下面 |
| `models` | string[] | 是 | 一并写入的模型 id 清单；中继没有可用模型时直接报错，所以至少一个 |
| `outcome` | "created" \| "overwritten" \| "updated" | 是 | 本次写入与已有配置的关系 |

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
| `providers[].models[].contextBudget` | integer（>0） | 否 | — | 有效上下文预算（token）：到达它就压缩，留空按窗口推算（见 `harness/setup/budget`）。 单步延迟随上下文线性上升，而各模型的实际退化点相差很大（声明窗口常常远大于可用窗口）， 这里给一个人工覆盖的口子。 |
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
| `websearch` | object | 否 | — | — |
| `websearch.provider` | "tavily" \| "searxng" \| "brave" | 否 | — | — |
| `websearch.apiKey` | string | 否 | — | — |
| `websearch.baseUrl` | string | 否 | — | — |
| `memory` | object | 否 | — | — |
| `memory.enabled` | boolean | 否 | — | — |
| `browser` | object | 否 | — | — |
| `browser.mode` | "isolated" \| "attach" | 否 | — | — |
| `browser.endpoint` | string | 否 | — | — |
| `browser.profile` | string | 否 | — | — |

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
| `parentSessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | 列表的父子过滤：缺省只出根会话（`parentSessionId` 为空的）； 传某个会话 id 时改为列出它的子会话。 |

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
| `thinkingLevel` | "auto" \| "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | — | — |
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
| `preview` | string | 是 | 首条用户消息（含合成输入）；供命令面板搜索，界面标题不回落它 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 思考档位偏好：`auto` 表示按本会话模式的推荐档位 |
| `resolvedThinkingLevel` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 实际生效的思考档位（`auto` 解析后的结果）。 会话在内存时取 pi 的实际值——它已按模型能力夹过，可能不等于模式的推荐档位。 |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "auto" \| "default" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空 |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_plan" \| "waiting_question" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
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
| `goal` | [GoalView](#goalview) \| null | 是 | 当前会话目标；未设置或已清除时为空 |

### POST /api/v1/sessions/update

重命名 / 换模型 / 换推理等级 / 换模式 / 换权限档位 / 置顶

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `name` | string（长度≥1） | 否 | — | — |
| `model` | string（长度≥1） | 否 | — | — |
| `thinkingLevel` | "auto" \| "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | — | — |
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
| `preview` | string | 是 | 首条用户消息（含合成输入）；供命令面板搜索，界面标题不回落它 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 思考档位偏好：`auto` 表示按本会话模式的推荐档位 |
| `resolvedThinkingLevel` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 实际生效的思考档位（`auto` 解析后的结果）。 会话在内存时取 pi 的实际值——它已按模型能力夹过，可能不等于模式的推荐档位。 |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "auto" \| "default" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空 |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_plan" \| "waiting_question" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
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
| `preview` | string | 是 | 首条用户消息（含合成输入）；供命令面板搜索，界面标题不回落它 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 思考档位偏好：`auto` 表示按本会话模式的推荐档位 |
| `resolvedThinkingLevel` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 实际生效的思考档位（`auto` 解析后的结果）。 会话在内存时取 pi 的实际值——它已按模型能力夹过，可能不等于模式的推荐档位。 |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "auto" \| "default" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空 |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_plan" \| "waiting_question" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
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
| `preview` | string | 是 | 首条用户消息（含合成输入）；供命令面板搜索，界面标题不回落它 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 思考档位偏好：`auto` 表示按本会话模式的推荐档位 |
| `resolvedThinkingLevel` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 实际生效的思考档位（`auto` 解析后的结果）。 会话在内存时取 pi 的实际值——它已按模型能力夹过，可能不等于模式的推荐档位。 |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "auto" \| "default" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空 |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_plan" \| "waiting_question" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
| `pinnedAt` | string \| null | 是 | 置顶时间；非空表示置顶，排序时置顶项排在组内最前 |
| `lastReadAt` | string \| null | 是 | 上次打开（标记已读）时间；用于判定未读：`updatedAt` 晚于它即未读 |
| `deletedAt` | string \| null | 是 | 归档时间；非空表示已归档（软删），列表默认过滤 |

## projects（`projects`）

### POST /api/v1/projects/list

项目列表（按 cwd 归口的展示名与最近的会话参数）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`ProjectListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `projects` | [ProjectSummary](#projectsummary)[] | 是 | — |

### POST /api/v1/projects/update

重命名项目（name 传 null 即清空，界面回落目录末段）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |
| `name` | string（长度≥1） \| null | 否 | — | 新的展示名；`null` 表示清空（客户端回落目录末段） |
| `memoryEnabled` | boolean \| null | 否 | — | 项目级记忆开关：`null` 表示回到「跟随全局 `memory.enabled`」 |

**响应类型**：`ProjectSummary`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `path` | string | 是 | 归一化后的绝对路径；项目的自然键，会话按 cwd 归到它上面 |
| `name` | string \| null | 是 | 展示名；为空时客户端回落目录末段 |
| `model` | string \| null | 是 | 最近一次在该项目里选择的模型；为空表示未记住，或记住的那个已不可用 |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" \| null | 是 | 最近一次在该项目里选择的思考档位偏好；为空表示未记住 |
| `mode` | string \| null | 是 | 最近一次在该项目里选择的会话模式；为空表示未记住，或该模式的角色已不存在 |
| `permissionMode` | "auto" \| "default" \| "full" \| null | 是 | 最近一次在该项目里选择的权限档位；为空表示未记住 |
| `memoryEnabled` | boolean | 是 | 项目级记忆开关的覆盖：`null` 表示未设过（跟随全局 `memory.enabled`）， 否则是这个目录的显式开关。侧栏项目行据此标「已开启记忆」。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |

### POST /api/v1/projects/reorder

重排项目（paths 是侧栏从上到下的目录次序）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `paths` | string（长度≥1）[]（≥1 项） | 是 | — | — |

**响应类型**：`ProjectListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `projects` | [ProjectSummary](#projectsummary)[] | 是 | — |

## 记忆（`memory`）

### POST /api/v1/memory/list

列出有记忆的项目与条目（只读）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`MemoryListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `projects` | [MemoryProjectView](#memoryprojectview)[] | 是 | 有记忆的项目，按记忆目录名排序 |

### POST /api/v1/memory/read

读一条记忆的正文（按记忆目录名 + 事实文件名寻址）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `dir` | string（长度 1–128） | 是 | — | — |
| `file` | string（长度 1–128） | 是 | — | — |

**响应类型**：`MemoryFactView`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `dir` | string | 是 | — |
| `file` | string | 是 | — |
| `title` | string | 是 | — |
| `content` | string | 是 | 事实文件全文（含首行的标题与结尾换行） |

### POST /api/v1/memory/update

改一条记忆的标题与正文（文件名不变）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `dir` | string（长度 1–128） | 是 | — | — |
| `file` | string（长度 1–128） | 是 | — | — |
| `title` | string（长度 1–120） | 是 | — | — |
| `content` | string（长度 1–20000） | 是 | — | — |

**响应类型**：`MemoryFactView`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `dir` | string | 是 | — |
| `file` | string | 是 | — |
| `title` | string | 是 | — |
| `content` | string | 是 | 事实文件全文（含首行的标题与结尾换行） |

### POST /api/v1/memory/delete

删一条记忆（文件与索引行一起删）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `dir` | string（长度 1–128） | 是 | — | — |
| `file` | string（长度 1–128） | 是 | — | — |

**响应类型**：`MemoryDeleteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `dir` | string | 是 | — |
| `file` | string | 是 | — |
| `removed` | boolean | 是 | 是否命中并删除；目标已不存在时为 false |

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
| `queued` | number | 是 | 队列里的输入条数（生成中投递、还没轮到的那些）。 只报条数：排队的输入只存在于服务端内存与 pi 的队列里，展开后的正文也不适合回显； 客户端自己记着发出过哪几条，拿这个数校对即可（页面刷新后就只剩这个数）。 |
| `subagents` | [SubagentSnapshot](#subagentsnapshot)[] | 是 | 仍在进行的子智能体；断流重连后客户端据此重建/收敛嵌套进度 |
| `services` | [BackgroundService](#backgroundservice)[] | 是 | 本会话当前可连的后台服务；断流重连后客户端以它为准替换本地清单 |
| `seq` | number | 是 | 快照序号：本响应已包含到该序号为止的全部事件效果。 客户端订阅后丢弃 seq <= 它的实时帧，可无缝接续。 |
| `liveMessageId` | string | 否 | 投影出的在途消息 id；前端据此把该条标记为生成中 |

### POST /api/v1/messages/services

会话的后台服务清单（响应前重探一次，供活动面板用）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`MessageServicesResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `services` | [BackgroundService](#backgroundservice)[] | 是 | — |

### POST /api/v1/messages/prompt

投递一轮生成，返回受理 ack；结果走 /events

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `text` | string | 否 | `` | 用户写的正文（`@` 引用与附件的位置标记都在里面）；命令与技能不在这里，见 `command` / `skills` |
| `contexts` | object[]（≤32 项） | 否 | — | — |
| `contexts[].path` | string（长度≥1） | 是 | — | — |
| `contexts[].startLine` | integer（>0） | 否 | — | — |
| `contexts[].endLine` | integer（>0） | 否 | — | — |
| `attachments` | object[]（≤8 项） | 否 | — | — |
| `attachments[].id` | string（格式 `^[0-9a-f]{64}$`） | 是 | — | — |
| `command` | object | 否 | — | 这条输入是一条命令调用时带上（最多一条）；缺省即普通消息 |
| `command.name` | string（长度≥1） | 是 | — | 命令模板文件名（不含 `.md`） |
| `command.args` | string | 否 | `` | — |
| `skills` | object[]（≤32 项） | 否 | — | 这条输入用到的技能（可多条，按顺序注入）；与 `command` 可以并存 |
| `skills[].name` | string（长度≥1） | 是 | — | 技能名（目录名或 `SKILL.md` 所在目录） |
| `skills[].args` | string | 否 | `` | — |
| `behavior` | "follow-up" \| "steer" | 否 | `follow-up` | 生成中再发消息时的投递方式 |

**响应类型**：`PromptAdmittedResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `admitted` | boolean | 是 | — |
| `queued` | boolean | 是 | 会话正在生成：这条输入已进队列，等当前这轮（含工具调用）结束再送出。 只有 `messages/prompt` 可能为 true——编辑与压缩不排队，它们要么当场生效要么报 409。 |

### POST /api/v1/messages/edit

编辑一条已发送的用户消息并重发

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `entryId` | string（长度≥1） | 是 | — | — |
| `text` | string | 否 | `` | — |
| `contexts` | object[]（≤32 项） | 否 | — | — |
| `contexts[].path` | string（长度≥1） | 是 | — | — |
| `contexts[].startLine` | integer（>0） | 否 | — | — |
| `contexts[].endLine` | integer（>0） | 否 | — | — |
| `attachments` | object[]（≤8 项） | 否 | — | — |
| `attachments[].id` | string（格式 `^[0-9a-f]{64}$`） | 是 | — | — |
| `command` | object | 否 | — | — |
| `command.name` | string（长度≥1） | 是 | — | 命令模板文件名（不含 `.md`） |
| `command.args` | string | 否 | `` | — |
| `skills` | object[]（≤32 项） | 否 | — | — |
| `skills[].name` | string（长度≥1） | 是 | — | 技能名（目录名或 `SKILL.md` 所在目录） |
| `skills[].args` | string | 否 | `` | — |

**响应类型**：`PromptAdmittedResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `admitted` | boolean | 是 | — |
| `queued` | boolean | 是 | 会话正在生成：这条输入已进队列，等当前这轮（含工具调用）结束再送出。 只有 `messages/prompt` 可能为 true——编辑与压缩不排队，它们要么当场生效要么报 409。 |

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
| `queued` | boolean | 是 | 会话正在生成：这条输入已进队列，等当前这轮（含工具调用）结束再送出。 只有 `messages/prompt` 可能为 true——编辑与压缩不排队，它们要么当场生效要么报 409。 |

### POST /api/v1/messages/dequeue

撤回排队中的输入（整清，返回撤掉的条数）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`MessageDequeueResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `queued` | number | 是 | 被撤掉并退回的排队输入条数；没有排队时为 0 |

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
| `kind` | "binary" \| "text" | 是 | — |
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
| `branch` | string | 否 | 当前分支名；分离头指针时为空字符串，仓库还没有提交时整项缺省 |
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
| `status` | "added" \| "conflicted" \| "copied" \| "deleted" \| "modified" \| "renamed" \| "typeChanged" | 是 | — |
| `binary` | boolean | 是 | — |
| `additions` | number | 是 | — |
| `deletions` | number | 是 | — |
| `hunks` | [GitHunk](#githunk)[] | 是 | — |
| `truncated` | boolean | 是 | — |

### POST /api/v1/git/contents

单文件对比两侧的原文（展开未变更区域用）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string（长度≥1） | 是 | — | — |
| `file` | string（长度≥1） | 是 | — | — |
| `source` | "worktree" \| "staged" \| "commit" | 否 | `worktree` | — |
| `commit` | string（长度≥1） | 否 | — | `source` 为 `commit` 时的提交 hash；其他来源忽略 |

**响应类型**：`GitContentsResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 仓库相对路径 |
| `old` | [GitFileVersion](#gitfileversion) | 否 | 对比基准一侧 |
| `new` | [GitFileVersion](#gitfileversion) | 否 | 对比目标一侧 |

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

## 插件（`plugins`）

### POST /api/v1/plugins/list

列出已登记的插件、组件摘要与诊断

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `cwd` | string（长度≥1） | 否 | — | 当前工作目录。给了就按它读项目级覆盖（`<cwd>/.<slug>/plugins.json` 与 `plugins.local.json`）， 每条插件的 `enabled` / `enabledBy` 是**该仓库里的生效值**；不给只算用户级。 |

**响应类型**：`PluginsListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugins` | [PluginView](#pluginview)[] | 是 | — |
| `statePath` | string | 是 | 状态文件绝对路径，供设置页展示与排查 |
| `revision` | number | 是 | 注册表代次：变更入口推进它，会话按它决定是否重建 |
| `overrides` | [PluginOverridesView](#pluginoverridesview) \| null | 是 | 项目级覆盖的来源与诊断；请求没带 `cwd` 时为 null |

### POST /api/v1/plugins/create

按来源（本地目录 / url / npm / github / git）安装并登记插件

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | object（source = "directory" \| "url" \| "npm" \| "github" \| "git"） | 是 | — | — |
| `marketplace` | string（格式 `^[a-z0-9][a-z0-9._-]{0,63}$`） | 否 | — | 归属市场；缺省表示直接登记本地目录（信任档位 local） |
| `enabled` | boolean | 否 | `true` | 登记即启用。安装副本只有用户级一处（`$APP_HOME/plugins`）， 「这个仓库里开不开」由 `<cwd>/.<slug>/plugins.json` 的覆盖决定，不在安装入参里。 |

**source（source = "directory"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "directory" | 是 | — | — |
| `path` | string（长度≥1） | 是 | — | 仓内子目录；插件包不在仓根时用它 |

**source（source = "url"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "url" | 是 | — | — |
| `url` | string（长度≥1，格式 `^https:\/\/`） | 是 | — | — |
| `headers` | Record<string, string> | 否 | — | 仅 url 来源支持：下载 `.zip` / `.tgz` 时的附加请求头 |

**source（source = "npm"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "npm" | 是 | — | — |
| `package` | string（长度≥1） | 是 | — | — |

**source（source = "github"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "github" | 是 | — | — |
| `repo` | string（格式 `^[\w.-]+\/[\w.-]+$`） | 是 | — | — |
| `path` | string | 否 | — | 仓内子目录；插件包不在仓根时用它 |
| `ref` | string | 否 | — | — |

**source（source = "git"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "git" | 是 | — | — |
| `url` | string（长度≥1） | 是 | — | — |
| `path` | string | 否 | — | 仓内子目录；插件包不在仓根时用它 |
| `ref` | string | 否 | — | — |

**响应类型**：`PluginWriteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin` | [PluginView](#pluginview) | 是 | — |
| `revision` | number | 是 | — |

### POST /api/v1/plugins/update

启停插件或写入 userConfig 的值

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string（格式 `^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |
| `enabled` | boolean | 否 | — | — |
| `config` | Record<string, string \| number \| boolean> | 否 | — | `userConfig` 的值；类型由清单声明，这里只承载标量 |

**响应类型**：`PluginWriteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin` | [PluginView](#pluginview) | 是 | — |
| `revision` | number | 是 | — |

### POST /api/v1/plugins/delete

移除插件登记（purge 时一并清理缓存与插件数据）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string（格式 `^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |
| `purge` | boolean | 否 | `false` | — |

**响应类型**：`PluginDeleteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `removed` | boolean | 是 | 是否命中并移除了登记；目标不存在时报错，故恒为 true |
| `purged` | boolean | 是 | 是否连磁盘内容一并清理（`purge`）；本地目录来源的内容不会被删 |
| `revision` | number | 是 | — |

### POST /api/v1/plugins/refresh

按来源重读插件清单并推进代次

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string（格式 `^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |

**响应类型**：`PluginWriteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugin` | [PluginView](#pluginview) | 是 | — |
| `revision` | number | 是 | — |

## 插件市场（`marketplace`）

### POST /api/v1/marketplace/list

列出已登记的市场与刷新状态

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`MarketplacesListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `marketplaces` | [MarketplaceView](#marketplaceview)[] | 是 | — |
| `statePath` | string | 是 | 状态文件绝对路径，供设置页展示与排查 |

### POST /api/v1/marketplace/info

市场内插件列表（读上一次刷新的缓存，不触发网络）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |

**响应类型**：`MarketplacePluginsResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `marketplace` | [MarketplaceView](#marketplaceview) | 是 | — |
| `plugins` | [MarketplacePluginView](#marketplacepluginview)[] | 是 | — |
| `diagnostics` | [PluginDiagnosticView](#plugindiagnosticview)[] | 是 | 清单里被跳过的条目原因（缺 name、字段非法等）；刷新时随清单缓存在状态里 |

### POST /api/v1/marketplace/create

登记市场来源

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |
| `source` | object（source = "directory" \| "url" \| "github" \| "git"） | 是 | — | — |

**source（source = "directory"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "directory" | 是 | — | — |
| `path` | string（长度≥1） | 是 | — | 指向含 `marketplace.json` 的目录；条目里的相对路径相对它解析 |

**source（source = "url"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "url" | 是 | — | — |
| `url` | string（长度≥1，格式 `^https:\/\/`） | 是 | — | `marketplace.json` 直链；这种市场里没有本地仓库，条目必须用显式来源 |

**source（source = "github"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "github" | 是 | — | — |
| `repo` | string（格式 `^[\w.-]+\/[\w.-]+$`） | 是 | — | — |
| `ref` | string | 否 | — | — |

**source（source = "git"）**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `source` | "git" | 是 | — | — |
| `url` | string（长度≥1） | 是 | — | `marketplace.json` 直链；这种市场里没有本地仓库，条目必须用显式来源 |
| `ref` | string | 否 | — | — |

**响应类型**：`MarketplaceWriteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `marketplace` | [MarketplaceView](#marketplaceview) | 是 | — |
| `revision` | number | 是 | — |

### POST /api/v1/marketplace/delete

移除市场登记（下挂插件只失去来源，内容不删）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |

**响应类型**：`MarketplaceDeleteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `removed` | boolean | 是 | 是否命中并移除了登记；目标不存在时报错，故恒为 true |
| `orphanedPlugins` | string[] | 是 | 被移除市场下已登记的插件 id（只移除登记，不动磁盘内容） |
| `revision` | number | 是 | — |

### POST /api/v1/marketplace/refresh

刷新市场清单（本地目录 / url / github / git）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `name` | string（格式 `^[a-z0-9][a-z0-9._-]{0,63}$`） | 是 | — | — |

**响应类型**：`MarketplaceWriteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `marketplace` | [MarketplaceView](#marketplaceview) | 是 | — |
| `revision` | number | 是 | — |

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

## 资产（角色 / 技能 / 命令）（`assets`）

### POST /api/v1/assets/list

列出角色 / 技能 / 命令三类资产（含只读来源、被覆盖关系与解析失败的条目）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |

**响应类型**：`AssetsListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `agents` | [AssetView](#assetview)[] | 是 | — |
| `skills` | [AssetView](#assetview)[] | 是 | — |
| `commands` | [AssetView](#assetview)[] | 是 | — |
| `errors` | [AssetError](#asseterror)[] | 是 | 无法解析 / 被跳过的条目；模型用 write 直接写坏的文件也在这里暴露 |

### POST /api/v1/assets/read

读一条资产的详情（frontmatter 字段 + 正文 + 保留的额外行）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |
| `kind` | "agent" \| "skill" \| "command" | 是 | — | — |
| `path` | string（长度≥1） | 是 | — | — |

**响应类型**：`AssetDetail`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "agent" \| "command" \| "skill" | 是 | — |
| `name` | string | 是 | — |
| `label` | string | 是 | — |
| `description` | string | 是 | — |
| `source` | "agents-project" \| "agents-user" \| "builtin" \| "global" \| "plugin" \| "project" | 是 | — |
| `editable` | boolean | 是 | — |
| `scope` | "global" \| "project" | 否 | — |
| `path` | string | 是 | — |
| `mode` | "all" \| "primary" \| "subagent" | 否 | 角色专有字段 |
| `tools` | string[] | 否 | — |
| `model` | string | 否 | — |
| `thinking` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 否 | — |
| `advertise` | boolean | 否 | — |
| `hidden` | boolean | 否 | — |
| `argumentHint` | string | 否 | 命令专有字段 |
| `body` | string | 是 | frontmatter 之外的提示词正文 |
| `files` | string[] | 否 | 技能目录内的其余文件（相对技能目录）；删除时会一并删掉 |
| `extraLines` | string[] | 是 | 未建模的 frontmatter 行；保存时原样回传 |
| `warnings` | string[] | 是 | 非阻断的提示：技能名与目录名不一致、命令缺 description 等 |

### POST /api/v1/assets/save

新建或覆盖一条资产（落点由 kind + scope 决定，不接受路径）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |
| `kind` | "agent" \| "skill" \| "command" | 是 | — | — |
| `name` | string（长度 1–64） | 是 | — | — |
| `scope` | "global" \| "project" | 是 | — | — |
| `label` | string（长度 1–120） | 否 | — | 角色的展示名（frontmatter `name`）；缺省用文件名 |
| `description` | string（长度 1–1024） | 否 | — | 一句话说明；角色与技能必填，命令可缺省（pi 会取正文首行） |
| `mode` | "primary" \| "subagent" \| "all" | 否 | — | 角色类别；缺省 subagent |
| `tools` | string[] | 否 | — | 角色工具档位：空数组或 `["inherit"]` 表示继承父会话，其余为工具名白名单 |
| `model` | string（长度≥1） | 否 | — | — |
| `thinking` | "off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max" | 否 | — | — |
| `advertise` | boolean | 否 | — | — |
| `hidden` | boolean | 否 | — | — |
| `argumentHint` | string（长度 1–120） | 否 | — | 命令的参数提示（frontmatter `argument-hint`） |
| `body` | string（长度 1–200000） | 是 | — | frontmatter 之外的提示词正文 |
| `extraLines` | string[] | 否 | — | 未建模的 frontmatter 行，读详情时给出、保存时原样写回。 传文本而不是传值：服务端只做行拼接，不替用户重新序列化自己加的字段。 |

**响应类型**：`AssetSaveResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "agent" \| "command" \| "skill" | 是 | — |
| `name` | string | 是 | — |
| `path` | string | 是 | — |
| `created` | boolean | 是 | 本次是新建（true）还是覆盖已有文件（false） |

### POST /api/v1/assets/delete

删除一条资产（技能连目录一起删），只读来源拒绝

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |
| `kind` | "agent" \| "skill" \| "command" | 是 | — | — |
| `path` | string（长度≥1） | 是 | — | — |

**响应类型**：`AssetDeleteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "agent" \| "command" \| "skill" | 是 | — |
| `name` | string | 是 | — |
| `path` | string | 是 | — |
| `removed` | boolean | 是 | 是否命中并删除；目标不存在时为 false |

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

### POST /api/v1/goals/budget

只改目标的 token 预算（不动轮数与校验结果）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `tokenBudget` | integer（>0） \| null | 是 | — | — |

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
| `steps` | [StatsStepSummary](#statsstepsummary) | 是 | 区间内的步级耗时画像；区间内没有任何步记录时各指标为空 |

## design（`design`）

### POST /api/v1/design/snapshot

读设计稿的结构摘要（页面表、节点摘要、画布选中集、引用前缀）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `pageId` | string（长度 1–128） | 否 | — | — |

**响应类型**：`DesignSnapshot`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revision` | number | 是 | — |
| `pageId` | string | 是 | — |
| `pages` | [DesignPage](#designpage)[] | 是 | — |
| `nodes` | [DesignNodeSummary](#designnodesummary)[] | 是 | — |
| `selection` | string[] | 是 | — |
| `mentionPrefix` | string | 是 | 引用锚点前缀，形如 `@design:<会话 id>`；完整锚点由它 + `/<页>/<节点>` 拼成。 由服务端铸造而不是画布自己拼：锚点写进对话历史后比文档活得久，归属校验靠的就是这一截。 |
| `path` | string | 是 | 这份稿子落在哪个文件。默认在项目配置目录下、按会话标题命名； 用户把画布指向别处（`design/doc open`）时就是那个路径——画布上标出来，免得改错文件。 |
| `truncated` | boolean | 否 | 图层树是否被截断（超过服务端一次下发的行数上限）。 带上它是为了让人知道「画布里还有没列出来的节点」，而不是以为稿子只有这些。 |
| `warning` | string | 否 | 文档文件读不懂时给出的说明（已把坏文件留档），画布照实显示 |

### POST /api/v1/design/render

取整页 drawing（`revision` 与文档一致时 `svg` 为 null，画布据此跳过重绘）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `pageId` | string（长度 1–128） | 否 | — | — |
| `revision` | integer（≥0） | 否 | — | — |

**响应类型**：`DesignRender`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revision` | number | 是 | — |
| `pageId` | string | 是 | — |
| `svg` | string \| null | 是 | 整页 SVG 原文；空画布为空串，陈旧为 null |
| `boxes` | Record<string, DesignBox> | 是 | — |
| `bounds` | [DesignBox](#designbox) \| null | 是 | 内容外接矩形；空画布为 null（画布据此收起「适应视图」） |

### POST /api/v1/design/select

写回画布选中集（不存在的 id 会被过滤）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `ids` | string（长度 1–128）[]（≤256 项） | 是 | — | — |

**响应类型**：`DesignSelection`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `sessionId` | string | 是 | — |
| `selection` | string[] | 是 | — |

### POST /api/v1/design/files

列出项目里的设计稿文件（标出本会话当前在改的那份）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |

**响应类型**：`DesignFilesResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `files` | [DesignFileEntry](#designfileentry)[] | 是 | — |
| `truncated` | boolean | 是 | 扫描是否被上限截断 |

### POST /api/v1/design/node

读一个设计节点的完整属性（属性浮窗）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `id` | string（长度 1–128） | 是 | — | — |

**响应类型**：`DesignNodeDetail`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | — |
| `type` | string | 是 | 节点类型：`FRAME` / `TEXT` / `RECTANGLE` 等 |
| `path` | string | 是 | 图层路径，如 `我的 / 资料卡 / 标题` |
| `x` | number | 是 | — |
| `y` | number | 是 | — |
| `width` | number | 是 | — |
| `height` | number | 是 | — |
| `rotation` | number | 是 | — |
| `opacity` | number | 是 | — |
| `visible` | boolean | 是 | — |
| `cornerRadius` | number | 是 | — |
| `fills` | [DesignPaint](#designpaint)[] | 是 | — |
| `strokes` | [DesignPaint](#designpaint)[] | 是 | — |
| `strokeWeight` | number | 是 | — |
| `layoutMode` | string | 是 | 自动布局方向：`NONE` / `HORIZONTAL` / `VERTICAL` |
| `itemSpacing` | number | 是 | — |
| `padding` | object | 是 | — |
| `padding.top` | number | 是 | — |
| `padding.right` | number | 是 | — |
| `padding.bottom` | number | 是 | — |
| `padding.left` | number | 是 | — |
| `childCount` | number | 是 | — |
| `text` | [DesignTextProps](#designtextprops) | 否 | 文本属性；非文本节点没有 |

### POST /api/v1/design/doc

文档级动作：立刻落盘 / 清空重来 / 换一页

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（格式 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`） | 是 | — | — |
| `action` | "flush" \| "reset" \| "setPage" \| "createPage" \| "open" | 是 | — | — |
| `pageId` | string（长度 1–128） | 否 | — | — |
| `name` | string（长度 1–60） | 否 | — | 新建页的名字；不给就按「页面 N」编号 |
| `path` | string（长度≥1） | 否 | — | `open` 的目标文件：把本会话的画布指向它（不存在就新建）。 相对路径按会话工作目录解析；扩展名必须是 `.design`（内容仍是 JSON）。 |

**响应类型**：`DesignDocResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `revision` | number | 是 | — |
| `pageId` | string | 否 | — |

## browser（`browser`）

### POST /api/v1/browser/list

列出浏览器 profile（占用、最后使用时间、是否使用中）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`BrowserListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `profiles` | [BrowserProfileView](#browserprofileview)[] | 是 | — |
| `root` | string | 是 | profile 存放根目录（设置页用它说明数据落在哪） |
| `limits` | object | 是 | — |
| `limits.maxProfiles` | number | 是 | 持久化 profile 份数上限 |
| `limits.maxBytes` | number | 是 | 单份占用上限 |

### POST /api/v1/browser/delete

删除浏览器 profile（使用中的跳过，传全集即清空）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `names` | string（长度≥1）[]（≤64 项） | 是 | — | — |

**响应类型**：`BrowserDeleteResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `deleted` | string[] | 是 | — |
| `missing` | string[] | 是 | — |
| `skipped` | object[] | 是 | — |
| `skipped[].name` | string | 是 | — |
| `skipped[].reason` | string | 是 | — |

### POST /api/v1/browser/desktop

桌面端浏览器通道的当前状态（有哪些标签、当前在看哪一个）

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`DesktopChannelState`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `connected` | boolean | 是 | 桌面端是否接着（接上但还没报过标签也算接上） |
| `tabs` | [DesktopBrowserTab](#desktopbrowsertab)[] | 是 | — |

### POST /api/v1/browser/desktop/ticket

签一张桌面端浏览器通道的一次性握手票

**请求参数**

无参数（body 传 `{}`）

**响应类型**：`DesktopTicketResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ticket` | string | 是 | — |
| `expiresAt` | string | 是 | — |

### GET /api/v1/browser/desktop

桌面端浏览器通道（WebSocket：上报标签集合与激活项，agent 驱动当前激活的那个）

**握手参数**

`terminalId`：终端 id；`ticket`：`POST /api/v1/terminal/ticket` 签发的一次性票据（30 秒内有效、只能用一次）。

**协议**

WebSocket：上行文本帧 = 用户输入原文，下行二进制帧 = PTY 输出字节；
结束与拒绝由关闭码表达（`1000` 带 `exit:<code>`、`4401` 票据无效、`4404` 终端不存在、`4403` 客户端跟不上输出）。
详见 `docs/api.md` 的「终端」一节。

## 终端（`terminal`）

### POST /api/v1/terminal/create

起一个终端（按会话 id 或工作目录归口）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（长度≥1） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |
| `cols` | integer（≥2，≤1000） | 是 | — | — |
| `rows` | integer（≥1，≤500） | 是 | — | — |

**响应类型**：`TerminalCreateResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 终端 id（进程内唯一） |
| `sequence` | number | 是 | 该终端在所属目录里的创建序号（从 1 起，**不随关闭回收**）。 界面用它给用户区分多个终端：按列表下标编号会在关掉中间一个时整体前移。 |
| `cwd` | string | 是 | 工作目录绝对路径；终端按它归口，同目录的会话共用同一批终端 |
| `shell` | string | 是 | 服务端用的 shell 可执行文件 |
| `cols` | number | 是 | — |
| `rows` | number | 是 | — |
| `running` | boolean | 是 | 是否仍在运行；已退出时为 false，`exitCode` 随之有值 |
| `pid` | number | 是 | 进程 id |
| `exitCode` | number \| null | 是 | 退出码；仍在运行时为 null |
| `createdAt` | string | 是 | — |

### POST /api/v1/terminal/list

列出某工作目录下的终端（客户端据此恢复标签）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `sessionId` | string（长度≥1） | 否 | — | — |
| `cwd` | string（长度≥1） | 否 | — | — |

**响应类型**：`TerminalListResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `terminals` | [TerminalInfo](#terminalinfo)[] | 是 | 该工作目录下的终端，按创建时间先后 |

### POST /api/v1/terminal/resize

改终端尺寸（前端按实测值上报）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `terminalId` | string（长度≥1） | 是 | — | — |
| `cols` | integer（≥2，≤1000） | 是 | — | — |
| `rows` | integer（≥1，≤500） | 是 | — | — |

**响应类型**：`TerminalResizeResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cols` | number | 是 | 实际生效的尺寸（服务端按取值域夹取后） |
| `rows` | number | 是 | — |

### POST /api/v1/terminal/close

结束终端（杀进程并摘除条目）

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `terminalId` | string（长度≥1） | 是 | — | — |

**响应类型**：`TerminalCloseResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `closed` | boolean | 是 | 是否真的关掉了：终端不存在或已结束时为 false |

### POST /api/v1/terminal/ticket

签一张输出流的一次性握手票

**请求参数**

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `terminalId` | string（长度≥1） | 是 | — | — |

**响应类型**：`TerminalTicketResponse`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ticket` | string | 是 | — |
| `expiresAt` | string | 是 | 过期时间（ISO）；客户端不必用，留给排障 |

### GET /api/v1/terminal/stream

单终端输出流（WebSocket：先重放最近输出，再实时）

**握手参数**

`terminalId`：终端 id；`ticket`：`POST /api/v1/terminal/ticket` 签发的一次性票据（30 秒内有效、只能用一次）。

**协议**

WebSocket：上行文本帧 = 用户输入原文，下行二进制帧 = PTY 输出字节；
结束与拒绝由关闭码表达（`1000` 带 `exit:<code>`、`4401` 票据无效、`4404` 终端不存在、`4403` 客户端跟不上输出）。
详见 `docs/api.md` 的「终端」一节。

## 事件流

`POST /api/v1/events` 返回 `text/event-stream`，**不套封套**：SSE 事件名固定 `message`，
真正的类型在 `data` 的 JSON 里。心跳为 `: heartbeat` 注释行；订阅者队列满时服务端直接断流，
由客户端重连 + `messages/list` 快照补齐。

**事件帧结构**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "agent_settled" \| "compaction_end" \| "compaction_start" \| "design_update" \| "goal_update" \| "interaction_request" \| "interaction_resolved" \| "message_end" \| "message_start" \| "queue_update" \| "service_update" \| "session_archived" \| "session_created" \| "session_updated" \| "step_start" \| "subagent_end" \| "subagent_start" \| "text_delta" \| "thinking_delta" \| "tool_call" \| "tool_end" \| "tool_start" \| "tool_update" \| "transcript_reset" | 是 | — |
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

**取值之一（type = "projects_changed"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "projects_changed" | 是 | — |
| `projects` | [ProjectListResponse](#projectlistresponse) | 是 | — |

**取值之一（type = "plugins_changed"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "plugins_changed" | 是 | — |
| `revision` | number | 是 | — |
| `plugins` | [PluginsListResponse](#pluginslistresponse) | 是 | — |

**取值之一（type = "plugin_progress"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | "plugin_progress" | 是 | — |
| `message` | string | 是 | — |

**事件名（`type`）**

- `step_start`
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
- `design_update`
- `service_update`
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

### HubRuntimeView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `phase` | "connecting" \| "halted" \| "idle" \| "ready" \| "reconnecting" | 是 | 隧道所处阶段 |
| `connectedAt` | string \| null | 是 | 本次上线时刻（ISO）；未连接为 null |
| `lastError` | string \| null | 是 | 最近一次失败原因（中文，可直接展示）；已连上时为 null |
| `reconnectAttempt` | number | 是 | 已发起的重连次数；连上后归零 |

### CatalogProvider

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | — |
| `baseUrl` | string \| null | 是 | 内置目录里可能没有固定端点（这类 provider 不参与一键接入） |
| `api` | string | 是 | — |
| `source` | "builtin" \| "custom" | 是 | — |
| `available` | boolean | 是 | 该 provider 是否已配置可用的鉴权 |
| `authSource` | string \| null | 是 | 鉴权来源：stored / runtime / environment / fallback；未配置时为 null |
| `authName` | string | 是 | 鉴权说明文案，如 "DeepSeek API key" |
| `customized` | boolean | 是 | 用户是否覆盖了模型清单（覆盖后该 provider 不再跟随内置目录更新） |
| `models` | [CatalogModel](#catalogmodel)[] | 是 | — |

### ConfigView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `defaultModel` | string \| null | 是 | — |
| `providers` | [ProviderConfigView](#providerconfigview)[] | 是 | — |
| `websearch` | [WebsearchView](#websearchview) | 是 | — |
| `memory` | [MemoryView](#memoryview) | 是 | — |
| `browser` | [BrowserView](#browserview) | 是 | — |

### RuntimeStatus

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `configured` | boolean | 是 | 是否已有可用模型 |
| `defaultModel` | string \| null | 是 | 实际生效的 "provider/model" |
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
| `capabilitySource` | "catalog" \| "configured" \| "default" \| "heuristic" \| "upstream" | 是 | 上述能力的取值来源 |
| `configured` | boolean | 是 | 是否已存在于该 provider 的配置里（按 id 比对） |

### SessionSummary

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string \| null | 是 | — |
| `cwd` | string | 是 | 会话的工作目录：绑定目录的会话是那个目录，未绑定的是分配给它自己的工作区 （`<助理根>/<sessionId>`，见 `health.workspace`）。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |
| `preview` | string | 是 | 首条用户消息（含合成输入）；供命令面板搜索，界面标题不回落它 |
| `model` | string \| null | 是 | 生效的 "provider/model" |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 思考档位偏好：`auto` 表示按本会话模式的推荐档位 |
| `resolvedThinkingLevel` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 是 | 实际生效的思考档位（`auto` 解析后的结果）。 会话在内存时取 pi 的实际值——它已按模型能力夹过，可能不等于模式的推荐档位。 |
| `mode` | string | 是 | 会话模式（primary agent slug）：决定工具集与权限 |
| `permissionMode` | "auto" \| "default" \| "full" | 是 | 会话级权限档位：命中 `ask` 时是弹审批还是自动放行；不改变工具集与 `deny` |
| `parentSessionId` | string \| null | 是 | 父会话 id；子智能体会话非空 |
| `agent` | string \| null | 是 | 子智能体的角色 slug（如 `general` / `explore`）；主会话为空 |
| `forkedFromId` | string \| null | 是 | 本会话分叉自哪个会话（`sessions/fork` 生成）；非分叉会话为空 |
| `childCount` | number | 是 | 未归档的直接子会话数；主会话据此决定侧栏是否可下钻 |
| `running` | boolean | 是 | 是否有活跃生成（进程内的 run 或流式会话） |
| `status` | "error" \| "idle" \| "running" \| "waiting_permission" \| "waiting_plan" \| "waiting_question" | 是 | 细分状态：生成中 / 等待用户输入（权限审批、问答、计划确认）/ 已完成 / 本轮出错。 等待类状态的判定口径在服务端（见 `docs/api.md`「会话状态」），都由「这一轮已经停下、 等用户动作」构成；`running` 为真时 `status` 也可能不是生成中。 |
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
| `budget` | number \| null | 否 | 本次会话的压缩触发阈值（token）：到达它就自动压缩（见 `harness/setup/budget`）。 与窗口分开给出，因为触发点按「有效预算」算，不等于模型声明的窗口。 |
| `lastCompaction` | object \| null | 否 | 最近一次自动压缩：原因与实际发生时间；没发生过为空 |

### GoalView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `objective` | string | 是 | — |
| `status` | "active" \| "completed" \| "paused" | 是 | — |
| `cause` | "blocked" \| "budget" \| "error" \| "interrupted" \| "limit" \| "mode" \| "no_progress" \| "user" \| null | 是 | 暂停原因；`active` / `completed` 时为空 |
| `turns` | number | 是 | 已自动续跑的轮数（不含用户触发的那轮） |
| `tokenBudget` | number \| null | 是 | token 预算；为空表示不限 |
| `tokensUsed` | number | 是 | 目标开始后本会话累计消耗的 token（含校验调用） |
| `startedAt` | string | 是 | 目标设定时间（ISO 8601），也是用量统计的起点 |
| `updatedAt` | string | 是 | — |
| `verification` | [GoalVerification](#goalverification) \| null | 是 | 最近一次校验结果；还没校验过时为空 |

### ProjectSummary

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `path` | string | 是 | 归一化后的绝对路径；项目的自然键，会话按 cwd 归到它上面 |
| `name` | string \| null | 是 | 展示名；为空时客户端回落目录末段 |
| `model` | string \| null | 是 | 最近一次在该项目里选择的模型；为空表示未记住，或记住的那个已不可用 |
| `thinkingLevel` | "auto" \| "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" \| null | 是 | 最近一次在该项目里选择的思考档位偏好；为空表示未记住 |
| `mode` | string \| null | 是 | 最近一次在该项目里选择的会话模式；为空表示未记住，或该模式的角色已不存在 |
| `permissionMode` | "auto" \| "default" \| "full" \| null | 是 | 最近一次在该项目里选择的权限档位；为空表示未记住 |
| `memoryEnabled` | boolean | 是 | 项目级记忆开关的覆盖：`null` 表示未设过（跟随全局 `memory.enabled`）， 否则是这个目录的显式开关。侧栏项目行据此标「已开启记忆」。 |
| `createdAt` | string | 是 | — |
| `updatedAt` | string | 是 | — |

### MemoryProjectView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `dir` | string | 是 | 记忆目录名（位于 `memory/projects` 下），后续 `read` 按它寻址 |
| `path` | string \| null | 是 | 反查到的项目目录；反查不到时为 null |
| `name` | string \| null | 是 | 项目展示名（用户在侧栏改过的名字）；没有项目行时为 null |
| `enabled` | boolean | 是 | 该项目当下是否生效：项目级覆盖优先，未设过时跟随全局开关 |
| `entries` | [MemoryEntryView](#memoryentryview)[] | 是 | — |

### MessageDTO

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `role` | "assistant" \| "custom" \| "summary" \| "tool" \| "user" | 是 | — |
| `blocks` | [MessageBlock](#messageblock)[] | 是 | — |
| `model` | string | 否 | assistant 专用：产生该回复的模型 id |
| `provider` | string | 否 | assistant 专用：模型所属 provider id |
| `thinkingLevel` | "high" \| "low" \| "max" \| "medium" \| "minimal" \| "off" \| "xhigh" | 否 | assistant 专用：产生该回复时生效的推理等级 |
| `toolCallId` | string | 否 | tool 专用：与 toolCall block 的 id 对应，便于前端精确合并 |
| `toolName` | string | 否 | tool 专用 |
| `questionAnswers` | string[][] | 否 | tool 专用：`question` 的结构化答复，与调用入参里的 `questions` 同序（每项可多值） |
| `pruned` | boolean | 否 | tool 专用：该结果的正文已被旧输出清理（`[旧工具输出已清理…]`）替换——模型不再看到它， 但里头产出的图片仍在 `blocks` 里（投影会从原始条目补回来），界面据此说明这个差别。 |
| `customType` | string | 否 | custom 专用：扩展条目的来源标识，界面据此区分界面标记（如忽略计划的标记）与普通扩展消息 |
| `permissionDecision` | [PermissionRecord](#permissionrecord) | 否 | custom 专用：权限审批记录；只有该类型的扩展条目会带上 |
| `compactionRecord` | [CompactionRecord](#compactionrecord) | 否 | custom 专用：压缩记录；只有该类型的扩展条目会带上 |
| `goalRecord` | [GoalRecord](#goalrecord) | 否 | custom 专用：目标记录；只有该类型的扩展条目会带上（界面展示 `completed` 那一条） |
| `skillRecord` | [SkillRecord](#skillrecord) | 否 | custom 专用：技能命中记录；只有 `SKILL_RECORD_CUSTOM_TYPE` 的 `hit` 条目会带上 |
| `retryRecord` | [RetryRecord](#retryrecord) | 否 | custom 专用：模型请求重试记录；只有 `RETRY_RECORD_CUSTOM_TYPE` 会带上 |
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

### BackgroundService

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 端口十进制字符串；同端口重复起即覆盖同一条 |
| `command` | string | 是 | 起服务的命令原文（已截断） |
| `cwd` | string | 是 | 命令的工作目录 |
| `port` | number | 是 | 观测到的回环端口 |
| `url` | string | 是 | 服务端拼好的访问地址（`http://127.0.0.1:<port>`） |
| `startedAt` | string | 是 | 首次观测到该端口可连的时刻（ISO 8601 UTC） |
| `updatedAt` | string | 是 | 最后一次确认可连的时刻（ISO 8601 UTC）；服务端用它收敛清单上限 |

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
| `type` | "directory" \| "file" | 是 | — |
| `size` | number | 是 | 字节数；目录为 0 |
| `updatedAt` | string | 是 | — |

### GitFileChange

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | — |
| `oldPath` | string | 否 | — |
| `status` | "added" \| "conflicted" \| "copied" \| "deleted" \| "modified" \| "renamed" \| "typeChanged" | 是 | — |
| `additions` | number \| null | 是 | 新增行数；未跟踪、重命名与二进制文件无法统计时为 null |
| `deletions` | number \| null | 是 | 删除行数；无法统计时为 null |

### GitHunk

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `header` | string | 是 | — |
| `lines` | [GitDiffLine](#gitdiffline)[] | 是 | — |

### GitFileVersion

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `text` | string | 否 | — |
| `binary` | boolean | 是 | — |
| `truncated` | boolean | 是 | 是否因超出内联上限而未给内容 |

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
| `timeout` | number | 否 | 单请求超时（秒），省略即用 pi 默认 60 |
| `type` | "stdio" | 是 | — |
| `command` | string | 是 | — |
| `args` | string[] | 否 | — |
| `env` | Record<string, string> | 否 | — |
| `cwd` | string | 否 | 相对路径按会话工作目录解析 |

**取值之一（type = "http"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | — |
| `enabled` | boolean | 是 | — |
| `exposure` | "codemode" \| "deferred" \| "direct" \| "hidden" | 是 | — |
| `timeout` | number | 否 | — |
| `type` | "http" | 是 | — |
| `url` | string | 是 | — |
| `headers` | Record<string, string> | 否 | — |

### PluginView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 身份 `<name>@<marketplace>`；直接登记的本地目录用 `<name>@local` |
| `name` | string | 是 | 清单里的 name，缺省取安装目录名 |
| `displayName` | string | 是 | 界面显示名，缺省与 `name` 相同 |
| `description` | string | 是 | — |
| `version` | string | 是 | — |
| `source` | "local" \| "market" \| "official" | 是 | 信任档位：执行类组件是否注入按它判定 |
| `enabled` | boolean | 是 | 生效的启用状态：项目 / 本地覆盖优先于用户登记表里的值 |
| `enabledBy` | "local" \| "project" \| "user" | 是 | `enabled` 由哪一层决定；界面据此提示「这个仓库里被设成了 X」 |
| `path` | string | 是 | 安装目录绝对路径（`${*_PLUGIN_ROOT}` 指向它） |
| `installedAt` | string | 是 | 安装时间（ISO 8601） |
| `components` | [PluginComponentCounts](#plugincomponentcounts) | 是 | — |
| `componentRefs` | [PluginComponentRefView](#plugincomponentrefview)[] | 是 | 组件逐个列出：列表只给计数，详情页要名字 |
| `userConfig` | [PluginUserConfigFieldView](#pluginuserconfigfieldview)[] | 是 | userConfig 的声明；没有配置项时为空数组 |
| `config` | Record<string, string \| number \| boolean> | 是 | userConfig 的已存值；敏感项不在其中（只体现 `configured` 语义） |
| `blockedComponents` | ("agents" \| "bin" \| "commands" \| "extensions" \| "hooks" \| "manifest" \| "mcp" \| "skills" \| "userConfig")[] | 是 | 按来源判定为「不注入运行时」的组件分组：界面据此直说为什么 hook 不跑 |
| `updateAvailable` | boolean | 是 | 来源内容是否已变（目录来源按内容哈希、git 按 ls-remote 的 commit、npm 按 registry 版本、 url 按条件请求判定）。由「刷新市场」这类显式动作重算，列表接口本身不打网络、不扫盘， 只回显上次结论。 |
| `latestVersion` | string | 否 | 远端最新版本：只有能判定出版本号的来源（npm / 清单声明）才有 |
| `checkedAt` | string | 否 | 上次检查更新的时间（ISO 8601）；从没检查过则缺省 |
| `diagnostics` | [PluginDiagnosticView](#plugindiagnosticview)[] | 是 | — |

### PluginOverridesView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `projectPath` | string | 是 | `<cwd>/.<slug>/plugins.json`：提交进仓库的那份 |
| `localPath` | string | 是 | `<cwd>/.<slug>/plugins.local.json`：个人覆盖（建议 gitignore） |
| `diagnostics` | string[] | 是 | — |

### MarketplaceView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 市场身份，插件 id 的后半段 |
| `source` | string | 是 | 来源的展示用字面量：目录路径 / url / `owner/repo` |
| `builtin` | boolean | 是 | 随包内置的市场：刷新失败只落 `lastError`，不出用户可见错误 |
| `lastRefreshAt` | string | 否 | — |
| `refreshedOk` | boolean | 是 | 上一次刷新是否成功；从没刷新过为 false |
| `lastError` | string | 否 | — |
| `pluginCount` | number | 是 | 清单里的条目数；没刷新过为 0 |

### MarketplacePluginView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | — |
| `description` | string | 是 | — |
| `version` | string | 是 | — |
| `installedId` | string \| null | 是 | 已安装时的插件 id（`<name>@<marketplace>`）；未安装为 null |
| `updateAvailable` | boolean | 是 | 已安装且可更新；未安装恒为 false |
| `source` | object（source = "directory" \| "url" \| "npm" \| "github" \| "git"） \| null | 是 | 可直接安装的来源（相对路径在刷新时已按市场根解析）；解析不出来时为 null， 界面上的「安装」按钮据此禁用。 |

**source（source = "directory"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | "directory" | 是 | — |
| `path` | string | 是 | 本地目录；相对路径按安装时的进程 cwd 解析，登记后不再复制 |

**source（source = "url"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | "url" | 是 | — |
| `url` | string | 是 | — |
| `headers` | Record<string, string> | 否 | 仅 url 来源支持：下载 `.zip` / `.tgz` 时的附加请求头 |

**source（source = "npm"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | "npm" | 是 | — |
| `package` | string | 是 | — |

**source（source = "github"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | "github" | 是 | — |
| `repo` | string | 是 | — |
| `path` | string | 否 | 仓内子目录；插件包不在仓根时用它 |
| `ref` | string | 否 | — |

**source（source = "git"）**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `source` | "git" | 是 | — |
| `url` | string | 是 | — |
| `path` | string | 否 | — |
| `ref` | string | 否 | — |

### PluginDiagnosticView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `level` | "error" \| "info" \| "warning" | 是 | — |
| `component` | "agents" \| "bin" \| "commands" \| "extensions" \| "hooks" \| "manifest" \| "mcp" \| "skills" \| "userConfig" | 是 | 归属组件；清单本身的问题记 `manifest` |
| `message` | string | 是 | 面向用户的中文说明；服务端不本地化，与失败封套同一口径 |

### AgentView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `slug` | string | 是 | 角色 slug；主会话用它作 `mode`，子会话用它作 `agent` |
| `label` | string | 是 | 展示名 |
| `description` | string | 是 | 角色说明；供界面展示与模型挑选 |
| `kind` | "primary" \| "subagent" | 是 | — |
| `source` | "builtin" \| "global" \| "plugin" \| "project" | 是 | — |
| `hidden` | boolean | 否 | 是否对选择器隐藏（`hidden: true`）；隐藏项仍可按名调用 |

### AssetView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "agent" \| "command" \| "skill" | 是 | — |
| `name` | string | 是 | 资产名：角色的 slug、技能的目录名、命令的文件名 |
| `label` | string | 是 | 展示名：角色取 frontmatter `name`，其余同 `name` |
| `description` | string | 是 | 一句话说明；解析失败时为空串 |
| `source` | "agents-project" \| "agents-user" \| "builtin" \| "global" \| "plugin" \| "project" | 是 | 来源档位，顺序即同名优先级（前者胜） |
| `editable` | boolean | 是 | 是否可编辑（全局 / 项目两档为 true） |
| `scope` | "global" \| "project" | 否 | 可写档的落点作用域；只读来源缺省 |
| `path` | string | 是 | 磁盘路径；内置命令这类没有真身的项给 `builtin:<name>` |
| `active` | boolean | 是 | 是否生效：同名时优先级最高者为 true，被压住的为 false |
| `overriddenBy` | string | 否 | 压住它的那一条的路径；仅 `active` 为 false 时有 |

### AssetError

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "agent" \| "command" \| "skill" | 是 | — |
| `name` | string | 是 | — |
| `path` | string | 是 | — |
| `reason` | string | 是 | — |

### PromptCommandView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 命令名；调用时序列化为 `/name` |
| `description` | string | 是 | 一句话说明，供菜单展示 |
| `argumentHint` | string | 否 | 参数提示，如 `[focus]`；无参数时缺省 |
| `bytes` | number | 是 | 模板正文的 UTF-8 字节数：界面据此估计这条输入会往上下文里塞多少 |
| `source` | "agents-project" \| "agents-user" \| "builtin" \| "global" \| "plugin" \| "project" | 是 | 来源；同名时数组顺序靠前者胜 |

### SkillCommandView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 技能名；显式调用序列化为 `/skill:name`，模型也可按描述自动选用 |
| `description` | string | 是 | — |
| `bytes` | number | 是 | 技能正文（SKILL.md）的 UTF-8 字节数：一条消息可以带多条技能，界面据此提示上下文占用 |
| `source` | "agents-project" \| "agents-user" \| "builtin" \| "global" \| "plugin" \| "project" | 是 | — |

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
| `kind` | "forked" \| "primary" \| "subagent" | 是 | — |
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

### StatsStepSummary

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | [StepUsageTotals](#stepusagetotals) | 是 | — |
| `byModel` | [StepUsageBucket](#stepusagebucket)[] | 是 | 按 `provider/model` 分桶，按步数降序 |
| `byThinking` | [StepUsageBucket](#stepusagebucket)[] | 是 | 按思考档位分桶；取不到档位的步归 `unknown` |
| `daily` | [StepUsageBucket](#stepusagebucket)[] | 是 | 按服务端本地日期分桶（`YYYY-MM-DD`，只出有步的日） |

### DesignPage

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | — |

### DesignNodeSummary

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `name` | string | 是 | 图层名；模型与用户都按它认节点，所以工具会要求起有意义的名字 |
| `type` | string | 是 | 节点类型：`FRAME` / `TEXT` / `RECTANGLE` / `ELLIPSE` / `LINE` / `GROUP` / `COMPONENT` 等 |
| `x` | number | 是 | — |
| `y` | number | 是 | — |
| `width` | number | 是 | — |
| `height` | number | 是 | — |
| `parentId` | string \| null | 是 | 父节点 id；页面直属节点为空 |
| `depth` | number | 是 | 嵌套层级，页面直属节点为 0 |

### DesignBox

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `x` | number | 是 | — |
| `y` | number | 是 | — |
| `width` | number | 是 | — |
| `height` | number | 是 | — |

### DesignFileEntry

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `path` | string | 是 | 绝对路径 |
| `name` | string | 是 | 文件名 |
| `updatedAt` | string | 是 | 最后改动时间（ISO） |
| `current` | boolean | 是 | 是否为本会话当前在改的那份 |

### DesignPaint

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `type` | string | 是 | 画法，目前只有 `SOLID` |
| `color` | object | 是 | — |
| `color.r` | number | 是 | — |
| `color.g` | number | 是 | — |
| `color.b` | number | 是 | — |
| `color.a` | number | 是 | — |
| `opacity` | number | 是 | — |
| `visible` | boolean | 是 | — |
| `weight` | number | 否 | 描边粗细（像素）；填充没有这一项 |

### DesignTextProps

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `characters` | string | 是 | — |
| `fontSize` | number | 是 | — |
| `fontFamily` | string | 是 | — |
| `fontWeight` | number | 是 | — |
| `textAlignHorizontal` | string | 是 | `LEFT` / `CENTER` / `RIGHT` / `JUSTIFIED` |
| `lineHeight` | number \| null | 是 | 行高（像素）；未设置时为空 |
| `letterSpacing` | number | 是 | — |

### BrowserProfileView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | 是 | 目录名，也是 `browser_open` 的 `profile` 入参取值 |
| `bytes` | number | 是 | 占用字节数；`exact` 为 false 时只是个下界 |
| `exact` | boolean | 是 | 是否数完了整个目录（文件数或体积超过遍历上限即为 false） |
| `lastUsedAt` | string \| null | 是 | 最后一次改动时间（ISO）；取不到为 null |
| `inUse` | boolean | 是 | 是否正被某个浏览器实例持有（此时不能删） |

### DesktopBrowserTab

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | — |
| `title` | string | 是 | — |
| `url` | string | 是 | — |
| `webContentsId` | number \| null | 是 | — |
| `active` | boolean | 是 | 用户当前看的是这一个 |

### TerminalInfo

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 终端 id（进程内唯一） |
| `sequence` | number | 是 | 该终端在所属目录里的创建序号（从 1 起，**不随关闭回收**）。 界面用它给用户区分多个终端：按列表下标编号会在关掉中间一个时整体前移。 |
| `cwd` | string | 是 | 工作目录绝对路径；终端按它归口，同目录的会话共用同一批终端 |
| `shell` | string | 是 | 服务端用的 shell 可执行文件 |
| `cols` | number | 是 | — |
| `rows` | number | 是 | — |
| `running` | boolean | 是 | 是否仍在运行；已退出时为 false，`exitCode` 随之有值 |
| `pid` | number | 是 | 进程 id |
| `exitCode` | number \| null | 是 | 退出码；仍在运行时为 null |
| `createdAt` | string | 是 | — |

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

### ProjectListResponse

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `total` | number | 是 | — |
| `projects` | [ProjectSummary](#projectsummary)[] | 是 | — |

### PluginsListResponse

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `plugins` | [PluginView](#pluginview)[] | 是 | — |
| `statePath` | string | 是 | 状态文件绝对路径，供设置页展示与排查 |
| `revision` | number | 是 | 注册表代次：变更入口推进它，会话按它决定是否重建 |
| `overrides` | [PluginOverridesView](#pluginoverridesview) \| null | 是 | 项目级覆盖的来源与诊断；请求没带 `cwd` 时为 null |

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
| `api` | "anthropic-messages" \| "azure-openai-responses" \| "bedrock-converse-stream" \| "google-generative-ai" \| "google-vertex" \| "mistral-conversations" \| "openai-codex-responses" \| "openai-completions" \| "openai-responses" \| "pi-messages" | 是 | — |
| `apiKeyMasked` | string | 是 | 脱敏后的 key，仅用于回显「已保存」 |
| `models` | object[] | 否 | 留空表示模型清单继承 pi 内置目录 |

### WebsearchView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `provider` | "brave" \| "searxng" \| "tavily" | 是 | — |
| `apiKeyMasked` | string | 是 | — |
| `baseUrl` | string | 是 | 自建 SearXNG 的实例地址；其他 provider 恒为空串 |
| `configured` | boolean | 是 | 该 provider 的前置条件是否齐备（key 或实例地址）；决定 websearch 工具是否可用 |

### MemoryView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | 是 | — |

### BrowserView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | "attach" \| "isolated" | 是 | — |
| `endpoint` | string | 是 | — |
| `profile` | string | 是 | — |

### GoalVerification

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `achieved` | boolean | 是 | — |
| `reason` | string | 是 | — |
| `nextStep` | string | 是 | — |
| `at` | string | 是 | 校验时间（ISO 8601） |

### MemoryEntryView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | string | 是 | 事实文件名（仅文件名，与索引同目录） |
| `title` | string | 是 | — |
| `description` | string | 是 | 索引里那一行末尾的描述；空串表示没写 |

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
| `reason` | "manual" \| "overflow" \| "threshold" | 是 | — |
| `outcome` | "done" \| "failed" \| "skipped" | 是 | — |
| `tokensBefore` | number | 否 | 压缩前的上下文占用（token） |
| `tokensAfter` | number | 否 | 压缩后的估算占用（token）；pi 拿不到时省略 |
| `keptFrom` | string | 否 | 保留区间的起点条目 id（压缩后模型还看得到的部分从这里开始） |
| `skip` | "already_compacted" \| "too_small" | 否 | `skipped` 专用：正常拒绝的原因 |
| `error` | string | 否 | `failed` 专用：pi 给的原始失败原因 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### GoalRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event` | "budget" \| "clear" \| "completed" \| "pause" \| "resume" \| "set" \| "verdict" | 是 | — |
| `status` | "active" \| "completed" \| "paused" | 否 | 本次事件后的状态（`clear` 时缺省） |
| `cause` | "blocked" \| "budget" \| "error" \| "interrupted" \| "limit" \| "mode" \| "no_progress" \| "user" | 否 | `pause` 专用：暂停原因 |
| `turns` | number | 否 | 目标激活后累计的轮数 |
| `turnTokens` | number | 否 | 本轮的用量增量（token），含本轮校验开销；`verdict` 与 `completed` 都带 |
| `turnToolCalls` | number | 否 | 本轮的工具调用次数；`verdict` 与 `completed` 都带 |
| `turnMs` | number | 否 | 本轮耗时（毫秒）；起止时间可解析时才带 |
| `verdict` | object | 否 | 校验结论；`verdict` 与 `completed` 都带 |
| `tokensUsed` | number | 否 | 本轮的用量累计（token，含校验开销）；存储态只给当前值，历史需要自己带 |
| `objective` | string | 否 | 目标正文；只在 `set` 时带，其余从存储态能看出 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### SkillRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event` | "hit" \| "invoke" | 是 | 使用方式 |
| `name` | string | 是 | 技能名（pi 的 `Skill.name`） |
| `file` | string | 是 | 技能文件（`SKILL.md`）的绝对路径 |
| `source` | "agents-project" \| "agents-user" \| "builtin" \| "global" \| "plugin" \| "project" | 是 | 来源目录档位，与 `commands/list` 的 `source` 同口径 |
| `toolCallId` | string | 否 | 读到它的那次工具调用；仅 `hit` 有 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### RetryRecord

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event` | "end" \| "start" | 是 | 时点 |
| `attempt` | number | 是 | 第几次重试（1 起） |
| `maxAttempts` | number | 是 | 本次允许的最大重试次数 |
| `delayMs` | number | 否 | 距下次尝试的等待时长（毫秒）；仅 `start` 有 |
| `errorMessage` | string | 否 | 上游给的错误文本（外部内容，界面按纯文本截断展示，不渲染标记）；仅 `start` 有 |
| `success` | boolean | 否 | 重试链的结果：成功则这一轮继续，失败则是最终失败；仅 `end` 有 |
| `at` | string | 是 | 写入时刻（ISO 8601 UTC） |

### GoalPromptDetails

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | "continuation" \| "kickoff" \| "resume" | 是 | — |
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
| `kind` | "add" \| "ctx" \| "del" | 是 | — |
| `oldLine` | number \| null | 是 | — |
| `newLine` | number \| null | 是 | — |
| `text` | string | 是 | 行内容（不含前导的 +/-/空格） |

### PluginComponentCounts

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `skills` | number | 是 | — |
| `commands` | number | 是 | — |
| `agents` | number | 是 | — |
| `hooks` | number | 是 | — |
| `mcp` | number | 是 | — |
| `bin` | number | 是 | — |
| `extensions` | number | 是 | — |

### PluginComponentRefView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `group` | "agents" \| "bin" \| "commands" \| "extensions" \| "hooks" \| "manifest" \| "mcp" \| "skills" \| "userConfig" | 是 | — |
| `name` | string | 是 | — |

### PluginUserConfigFieldView

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 是 | — |
| `type` | string | 是 | 控件类型：string \| number \| boolean \| directory \| file \| select |
| `title` | string | 是 | — |
| `description` | string | 是 | — |
| `required` | boolean | 是 | — |
| `default` | string \| number \| false \| true | 否 | 缺省值；类型随 `type` |
| `options` | string[] | 否 | `select` 的候选值 |
| `multiple` | boolean | 否 | 允许多选（`select`） |
| `sensitive` | boolean | 否 | 敏感值：不回显（服务端只回传是否已设置） |

### StepUsageTotals

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `steps` | number | 是 | 记录到耗时数据的步数 |
| `turns` | number | 是 | 有步的用户轮数（按 `userTurn` 去重） |
| `stepsPerTurn` | number \| null | 是 | 平均每轮步数；没有步时为空 |
| `avgStepMs` | number \| null | 是 | 单步总耗时：均值与两个分位（毫秒） |
| `p50StepMs` | number \| null | 是 | — |
| `p90StepMs` | number \| null | 是 | — |
| `avgFirstEventMs` | number \| null | 是 | 请求发出 → 响应头（含上传与排队）的均值 |
| `avgTtftMs` | number \| null | 是 | 响应头 → 首个内容帧的均值（真正开始吐字前的静默） |
| `ttftShare` | number \| null | 是 | 累计首帧延迟（含排队）占总耗时的比例；分母为 0 时为空 |
| `toolShare` | number \| null | 是 | 纯工具耗时（已扣掉等用户）占总耗时的比例；分母为 0 时为空 |
| `toolCalls` | number | 是 | 步里的工具调用合计 |
| `failedSteps` | number | 是 | 以失败 / 中断收尾的步数（`stopReason` 为 `error` / `aborted`） |
| `cacheHitRate` | number \| null | 是 | 缓存命中率：命中读 /（未命中输入 + 命中读）；分母为 0 时为空 |

### StepUsageBucket

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `key` | string | 是 | — |
| `totals` | [StepUsageTotals](#stepusagetotals) | 是 | — |

### QuestionOption

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string | 是 | — |
| `description` | string | 是 | — |
