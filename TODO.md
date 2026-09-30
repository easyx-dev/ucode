# TODO

## P0 · 给 `/api/v1` 加鉴权，并默认只监听回环地址

> **状态：暂缓（2026-09-30）。** 只有收到用户的明确指令才启动；不要在其它阶段 / 任务里顺手做，也不要反复询问。落地前不得把服务暴露到公网或不可信网络（见 `AGENTS.md`「已知边界」）。

**现状（已在真实运行实例上验证）**：`server/src/index.ts` 的 `serve({ fetch: app.fetch, port: env.port })` 未指定 `hostname`，Node 绑定 `::`（所有网卡）；`app.use("*", cors({ origin: env.corsOrigin }))` 的默认值是 `*`；整个 `server/src` 没有任何请求级鉴权（只有 pi 自己的 `authPath`）。

实测：

```
curl http://192.168.1.149:2048/api/v1/health            → 200            # 同网段任意机器
curl -X POST http://192.168.1.149:2048/api/v1/models/list → 200（返回配置）
curl -i -X OPTIONS http://192.168.1.149:2048/api/v1/messages/prompt \
     -H 'Origin: https://evil.example' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: content-type'
     → 204, access-control-allow-origin: *
```

**风险**：agent 带 `read` / `write` / `edit` / `bash`，`APP_HOME` 指向真实仓库时，同网段任何人都能通过 HTTP 让它执行命令并读回结果；用户浏览任意网页时，该网页也能驱动本地服务（CORS 用 `*` 放行了预检）。

**待办**：

1. `/api/v1` 加 token 鉴权（`Authorization: Bearer <token>` 或 `X-Api-Token`）。token 首次启动随机生成，写入 `$APP_HOME/token`（0600）并打印到启动日志；`GET /api/v1/health` 放行。
2. 默认只监听回环：`serve({ fetch: app.fetch, port: env.port, hostname: process.env.HOST ?? "127.0.0.1" })`，需要局域网访问时用 `HOST=0.0.0.0` 显式开启。
3. `APP_CORS_ORIGIN` 默认改为 dev 下的 vite 源（`http://localhost:5173`），不再默认 `*`。生产是 server 同源托管 `apps/web/dist`，不依赖 CORS，收紧不会破坏部署。
4. 前端 `apps/web/src/lib/api.ts` 统一带上 token（存 localStorage 或构建时注入），设置页加一个 token 输入框。
5. `.env.example` / `README.md` 补 `HOST`、`API_TOKEN` 说明，并提示"不要把带 shell 权限的 agent 暴露到公网"。

**验收**：同网段 `curl http://<LAN-IP>:2048/api/v1/health` 连不上（默认回环）；带上正确 token 才能调用其他接口；无 token 返回 401；带 `Origin: https://evil.example` 的预检不再返回 `allow-origin: *`。

---

## 代码风格统一（命名 / 写法 / 注释）

**目标**：全项目的命名动词、声明写法、注释标点收敛成一套，读起来像同一个人写的。

**规范**：统一口径已并入 `AGENTS.md` 的「语言规范」（声明写法、命名动词、注释形式与标点）；本节只跟踪代码侧的存量修正。

**修正清单**

声明写法：

- `apps/web/src/lib/sse.ts`：`readSseStream` 由 `export async function` 改为 `export const ... = async () =>`
- `server/src/lib/validate/index.ts`：`jsonBody` 由 `export function` 改为 `export const ... = () =>`

转换函数方向：

- `server/src/core/session-index.ts`：`indexFromManager` → `managerToIndex`、`infoFromRecord` → `recordToInfo`
- `apps/web/src/lib/config-draft.ts`：`fromCatalogProvider` → `catalogToDraftProvider`（调用点 `apps/web/src/hooks/use-config-draft.ts` 一并改）
- `apps/web/src/components/directory-picker-dialog.tsx`：`asDirectoryInput` → `toDirectoryInput`
- `server/src/db/session-repository.ts`：`toRecord` → `rowToRecord`（点明源类型）

「选一个」用词：

- `apps/web/src/components/settings/provider-catalog.tsx`：`onPick` → `onSelect`
- `apps/web/src/components/session-sidebar-header.tsx`、`session-sidebar.tsx`：`onPickDirectory` → `onSelectDirectory`

布尔命名：

- `apps/web/src/components/chat-panel.tsx`：`showSuggestions` → `shouldShowSuggestions`
- `server/src/env.ts`：`legacyLayout` → `hasLegacyLayout`

获取类：

- `server/src/db/session-repository.ts`：收敛 `find` / `get` 的语义差异（`find` 只用于可能查不到，`get` 用于取了就用）

`env.ts` 目录命名（统一 `Dir` 后缀）：

- `workspaceRoot` → `workspacesDir`、`sessionsRoot` → `sessionsDir`、`repoRoot` → `repoDir`
- 同步 `CHANGELOG.md` 里 `env.workspaceRoot` 的引用

注释标点（单行 `//` 去掉句末 `。`；括号内为注释开头，便于重新定位）：

- `apps/web/src/hooks/use-session-stream.ts:148`（`hydration 重合…`）
- `packages/brand/scripts/verify.ts:95`（`只匹配当前品牌名…`）
- `packages/brand/scripts/verify.ts:96`（`因此品牌名不宜取常见子串…`）
- `server/src/core/pool.ts:103`（`绑定目录的会话在用户自己的目录里干活…`）
- `server/src/core/pool.ts:130`（`序号也不能随 detach 重置…`）
- `server/src/core/run.ts:67`（`而那一步现在只认已有记录…`）
- `server/src/core/run.ts:75`（`否则并发请求会一直排队…`）
- `server/src/agent/tools/ssrf.ts:50`（`代价是 NAT64…`）
- `server/src/index.ts:44`（`生产模式：同源托管 web 构建产物…`）
- `server/src/index.ts:46`（`所以先起服务、后 pnpm build 也能生效…`）
- `server/src/routes/messages/index.ts:30`（`只读文件会让刷新后的对话区空着…`）
- `server/src/routes/messages/index.ts:41`（`客户端按 seq 切分实时帧时…`）

文件级注释补全：

- `apps/web/src/components/message-list.tsx`、`message-item.tsx`、`tool-call-card.tsx`
- `apps/web/src/hooks/use-models.ts`
- `apps/web/src/lib/session.ts`（若不算「职责与路径同名」豁免）

**可选 · `pnpm verify` 兜底**：把能静态查的约定做成 check，避免随实现漂移——除 `components/`、`hooks/` 外禁止 `export function`；禁止 `interface`；单行 `//` 注释末尾不得为 `。`；非豁免文件必须有文件级注释。

**验收**：`pnpm check` 通过；上述清单全部消除。

---

## 新功能探索与思考
内置一系列的工具 tools，提示词命令（prompt），skiil
系统提示词（不使用 pi 的）提示词内容可以参考 opencode 是怎么写的
## 内置工具
### grep
使用正则表达式搜索文件内容。

### find
通过模式匹配查找文件。

### 网络搜索 websearch/webfetch
https://pi.dev/packages/pi-web-access

### question
https://pi.dev/packages/@juicesharp/rpiv-ask-user-question

## MCP 支持
pi 0.99 起内置 codemode / tool_search / MCP，不再用第三方 `pi-mcp-adapter`；接入方案见
[`plans/agent-tools-and-modes.md`](./plans/agent-tools-and-modes.md) 阶段 7a。

## 子智能体
参考 https://pi.dev/packages/pi-subagents

## TODO 工具
https://pi.dev/packages/@juicesharp/rpiv-todo

## wiki
https://pi.dev/packages/openwiki?name=wiki

## 权限控制
https://opencode.ai/v2/docs/permissions/
https://pi.dev/packages/@gotgenes/pi-permission-system

## plan 模式(计划模式)
参考 opencode 的计划模式 和 https://pi.dev/packages/@narumitw/pi-plan-mode?name=plan

待办：隐藏 `present_plan` 的工具卡片。它是内部信号、不是给用户看的工作产物，模型又可能在调用后补一句结束语甚至重复调用；在消息区过滤掉卡片，计划正文会更连贯。先记着，看实际观感再决定要不要做。

## 助手模式（ask）
最终设计已定稿，见 [`plans/agent-tools-and-modes.md`](./plans/agent-tools-and-modes.md)：模式 slug 用 `ask`（界面文案「问答」），
模式与工作区解耦，未绑定目录的会话落在 `$APP_HOME/workspace/<sessionId>`（就是它的工作目录，不预设子目录），只承诺只读工具集（禁 `bash`），不承诺只读权限。

## goal 模式(目标模式)
https://pi.dev/packages/@schovest/pi-goal
也可以参考 claude code ，zocode，codex 的
https://zcode.z.ai/cn/docs/goal

## 项目级记忆（Memory）
有些信息只值得告诉 Agent 一次：你习惯的 commit message 写法、项目用的包管理器、团队的评审约定。Memory 为 UCode Agent 提供项目级的长期记忆，让这类信息延续到后续会话，而不需要每次对话开头都重复交代。

开启后，UCode 会在每轮对话成功结束后于后台回顾最近的交流，判断是否有值得长期保留的内容——你的偏好、用户对 Agent 工作方式的纠正、项目目标与约束、你提供过的外部资料。保存下来的记忆会在同一项目的后续会话中自动带入上下文。

也可以在对话中直接管理记忆：说「记住，我们从 staging 分支发布」即可立刻保存；说「忘掉刚才说的发布分支」即可删除对应记忆。

### 会记住什么
Memory 聚焦四类信息：

类型	覆盖内容	示例
用户	你的身份、专长和偏好	「习惯用 pnpm 和 Conventional Commits」
反馈	对 Agent 工作方式的纠正或确认	「不要顺手修改无关文件里的 lint 报错」
项目	项目目标、约束与进展	「站点需要保持兼容 Node 20」
参考	你提供过的外部资源	「设计规范在团队 Wiki 的某个链接」

同样重要的是 Memory 刻意不记的内容：代码结构和 Git 历史（Agent 随时可以重新读取）、项目指令文件里已有的内容，以及只在当前对话内有效的临时信息。

### 工作机制
一轮对话成功结束后，后台流程会回顾最近的交流。如果发现值得保留的信息，就把它写成一个小的 Markdown 事实文件，并更新 MEMORY.md 索引；没有则什么都不保存。整个过程发生在你的回合结束之后，不会拖慢对话本身。

在同一项目的后续会话里，索引会自动加载进 Agent 的上下文，无需任何手动操作。记忆按项目隔离：UCode 在一个工作区学到的内容不会带到另一个工作区。

记忆存在哪里
记忆是保存在你本机的普通 Markdown 文件：

~/.ucode/app/memory/projects/<project>/memory/
├── MEMORY.md        # 索引，一行一条
└── *.md             # 每条事实一个文件

## 编辑历史对话
https://zcode.z.ai/cn/docs/edit-history

## 使用统计


（其余项见 README「常见问题」；已修的 review 问题不在此列。）

