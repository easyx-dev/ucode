# 附录 A · 调研结论

本附录记录 v1 架构决策所依据的外部事实。作用是：**当 v2 讨论中有人提出"为什么不用 X"时，答案已经在文档里**，不必重新调研。

内容分三部分：pi.dev 的事实、同类项目的做法、失败案例的教训。末尾有一节明确列出哪些是已验证事实、哪些是推断。

---

## 一、pi.dev 是什么

| 项 | 内容 |
|---|---|
| 域名 | `pi.dev` / `www.pi.dev`，自述 "a minimal agent harness" |
| 归属 | Earendil Inc.（`earendil.com` 自述 "tools to harness AI with Pi and Lefos"） |
| 仓库 | `github.com/earendil-works/pi`，MIT，TypeScript monorepo |
| npm 包 | `@earendil-works/pi-coding-agent`，bin 为 `pi`，要求 Node ≥ 22.19.0 |
| 官网包仓库 | `pi.dev/packages`，自报 5687 个包，是 pi 生态的分发入口 |

**易混淆项**：`pi.ai` 是 Inflection AI 的消费级助手，与本文无关。`github.com/earendil-works/pi` 的 README 提到 `badlogic/pi-share-hf`，暗示 Mario Zechner（badlogic）参与。

### workspace packages

`agent` · `ai` · `chord` · `client` · `coding-agent` · `durable` · `evals` · `protocol` · `server` · `session-backends` · `telemetry` · `tui`

其中与本架构直接相关的：

| 包 | 名字 | 内容 |
|---|---|---|
| `agent` | `@earendil-works/pi-agent-core` | agent loop、`Agent` 类、`AgentTool`、`agentLoop`、`streamProxy` |
| `ai` | `@earendil-works/pi-ai` | 统一多供应商 LLM API |
| `tui` | `@earendil-works/pi-tui` | 差分渲染 TUI 库 |
| `chord` | `@earendil-works/chord` | 插件/服务组合运行时，**transport-independent** 的服务 RPC，明确"不规定 framing / routing / transport / 应用层信封" |
| `durable` | `@earendil-works/pi-durable` | 存储后端（memory / JSONL / SQLite）。README **明确不支持跨进程锁与跨进程 ID 分配** |
| `session-backends/sqlite-node` | — | SQLite 会话后端 |

### 扩展机制（本架构直接依赖）

- **入口形态**：`export default function (pi: ExtensionAPI) { ... }`
- **加载**：本地扩展经 **jiti** 加载，`.ts` **无需编译**（`pi --extension ./hello.ts`）
- **发现路径**：`<agent-dir>/extensions/`、`.pi/extensions/`（直接 `.ts`/`.js` 文件，或含 `index.ts`/`index.js` 的子目录），也可经 settings 的 `extensions` 资源键声明
- **注册面**：`pi.on()` / `registerTool()` / `registerCommand()` / `registerShortcut()` / `registerFlag()` / `registerProvider()` / `sendUserMessage()` / `sendMessage()` / `appendEntry()` / `setActiveTools()` / `pi.events`（扩展间总线）
- **上下文**：`ctx.ui` / `ctx.mode` / `ctx.hasUI` / `ctx.sessionManager` / `ctx.modelRegistry` / `ctx.signal` / `ctx.reload()` / `ctx.shutdown()`
- **事件名**：`session_start` · `session_shutdown` · `before_agent_start` · `message_end` · `tool_call` · `tool_result` · `provider_stream_event` · `context` · `context_with_system` · `turn_end` · `agent_before_settle` · `agent_settled` · `project_trust` · `resources_discover` · `model_select` · `cache_warming_decision` · `user_bash`
- **分发**：pi packages（`pi-package` npm keyword）。`pi install npm:@example/pi-tools@1.0.0` / `git:github.com/example/pi-tools@v1` / `./local-package`；`pi list` / `pi remove` / `pi update --extensions`；`--local/-l`、`-e/--extension`
- **包布局**：`extensions/` `skills/` `prompts/` `themes/` 自动发现，或 `package.json` 的 `pi` 键显式声明
- **宿主包**：以 `peerDependencies: "*"` 提供 `@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui`、`typebox`

**MCP 未内建**。pi 首页把 MCP 列在 "What we didn't build" 下，生态里经第三方扩展接入（`pi-mcp-adapter` 等）。pi 也没有 Claude Code 那种 `settings.json` 的 hook 表——行为由命令式 TS 注册。

### 数据与配置布局（本架构的协议 D 沿用此约定）

- **agent-dir**：默认 `~/.pi/agent`，可用 `PI_CODING_AGENT_DIR` 覆盖。内含 `settings.json` / `keybindings.json` / `models.json` / `auth.json` / `AGENTS.md` / `AGENTS.override.md` / `CLAUDE.md` / `SYSTEM.md` / `APPEND_SYSTEM.md` / `extensions/` / `skills/` / `prompts/` / `themes/`
- **项目级**：`.pi/` 下的同名子集，仅在 `project_trust` 之后加载（例外：`sessionDir` 在 trust 之前读取）
- **优先级**：项目覆盖 agent-dir；资源列表**合并**
- **会话文件**：`~/.pi/agent/sessions/--<escaped-cwd>--/<timestamp>_<session-id>.jsonl`。`<escaped-cwd>` = 去掉开头分隔符后把 `/`、`\`、`:` 替换为 `-`。可经 `sessionDir` 设置 / `--session-dir` / `PI_CODING_AGENT_SESSION_DIR` / SDK `sessionDir` 覆盖
- **会话格式**：JSONL，版本化 header + entry 流。entry 经 `id`/`parentId` 构成树。版本 v1 线性 → v2 树 → **v3 当前**（把 `hookMessage` role 改名为 `custom`），加载时自动迁移到 v3
- **entry 类型**：`session` · `message` · `model_change` · `thinking_level_change` · `usage` · `compaction` · `context_edit` · `branch_summary` · `custom` · `custom_message` · `label` · `session_info`
- **设置键**：`defaultTools`（默认 `read, bash, edit, write`）、`compaction.*`、`branchSummary.*`、`transport`、`retry.*`、`resources`（`packages`/`extensions`/`skills`/`prompts`/`themes`），以及 `!pattern` / `+path` / `-path` 的包含排除语法

### 客户端/服务端能力现状

**A. 生产可用（文档化的 CLI 模式）**

- 交互 TUI（默认）
- `--print` / `-p`：一次性，末文本到 stdout；stdin/stdout 非 TTY 时自动选择
- `--mode json`：session header + 事件以 JSONL 输出。增量在 `message_update`，**权威在 `message_end`**。`agent_end` ≠ 完成，`agent_settled` 才是"无后续自动工作"
- `--mode rpc`：**长驻子进程，stdin 收 JSONL 命令，stdout 出响应 + 事件，LF 分帧**。需 `--no-session` 风格调用；拒绝 `@file` prompt 参数。**文档警告不要用 Node 的 `readline`**，因为 `U+2028`/`U+2029` 在 JSON 字符串里合法
  - 命令：`prompt` · `steer` · `follow_up` · `abort` · `clear_queue` · `new_session` · `get_state` · `get_messages` · `set_model` · `cycle_model` · `get_available_models` · `set_thinking_level` · `cycle_thinking_level` · `get_available_thinking_levels` · `set_steering_mode` · `set_follow_up_mode` · `compact` · `set_auto_compaction` · `set_auto_retry` · `abort_retry` · `bash` · `abort_bash` · `get_session_stats` · `export_html` · `switch_session` · `fork` · `clone` · `get_fork_messages` · `get_entries` · `get_tree` · `get_last_assistant_text` · `set_session_name` · `get_commands`
  - 关联：响应回带可选字符串 `id`，形状 `{"type":"response","command":...,"success":true,"data":{...}}`。解析错误返回 `command: "parse"` 且无 `id`
  - TS 辅助：`RpcClient`（从 `@earendil-works/pi-coding-agent` 或 `./rpc-entry` 子路径）
  - **扩展 UI 子协议**：`extension_ui_request` / `extension_ui_response`。阻塞且 id 匹配的方法：`select` / `confirm` / `input` / `editor`；fire-and-forget：`notify` / `setStatus` / `setWidget` / `setTitle` / `set_editor_text`
  - RPC 模式下 `ctx.hasUI === true` 但 `ctx.mode === "rpc"`，TUI 专用代码需用 `ctx.mode === "tui"` 守卫
- `--mode text`

**CLI 里没有** `serve` / `daemon` / `--port` / WebSocket 标志。（完整标志列表已核对。）

**B. SDK（进程内嵌入）**

导出 `createAgentSession()` / `SessionManager`（含 `.inMemory()`）/ `AgentSessionRuntime`（`newSession()` / `switchSession()` / `fork()` / `importFromJsonl()`）/ `DefaultResourceLoader` / `ModelRuntime` / `SettingsManager`。

会话表面：`prompt()` / `steer()` / `followUp()` / `abort()` / `waitForIdle()` / `subscribe()` / `.messages` / `.model` / `.thinkingLevel` / `.systemPrompt`（只读）/ `.getActiveToolNames()` / `.dispose()`

工厂覆写参数：`modelRuntime` / `model` / `thinkingLevel` / `scopedModels` / `settingsManager` / `sessionManager` / `resourceLoader` / `tools` / `noTools` / `excludeTools` / `customTools` / `InlineExtension`

文档原话：**"The SDK is not a CLI mode."**

**C. 实验性远程层（本架构刻意不复用，见 ADR-009）**

- `@earendil-works/pi-protocol`（协议版本 **8**）：路由信封，**CBOR**，分帧 = 4 字节无符号大端长度 + 一个定长 CBOR 项。目标地址为 `{serverId}` 或 `{serverId, sessionId, attachmentId}`。限制：16 MiB/帧、100 万元素、64 层嵌套。**协议层未实现认证**
- `@earendil-works/pi-server`：`RoutedServerServiceHost` / `ServerHost` / `Session` / `SessionDirectory` / `SessionManagement` / `MemorySessionRepo`；unix 子模块 `createUnixListener` / `createUnixServer` / `getUnixSocketPath`；`attachClient()` / `invokeService()`。**对端认证是应用策略，实验性 unix 传输不实现它**
- `@earendil-works/pi-client`：`Client.connect({serverId, transportFactory})` / `request()` / `subscribeService()` / `ServerError`；unix 子路径 `createUnixTransportFactory({path})` / `discoverUnixServers({directory})`。**不自动重连、不重放**——调用方必须自己 `reconnect()` 并重新 attach
- coordinator（`src/experimental/coordinator.ts`）：**仅传输垫片**，`COORDINATOR_PROTOCOL_VERSION` / `ensureCoordinator()` / `runCoordinatorProcess()`。消息：`register_server` / `register_peer` / `server_registered` / `server_connected` / `server_disconnected` / `server_replaced` / `send` / `broadcast`。"public" 连接经 **TCP 管道**接到当前 server；peer 与 server 走 unix 控制 socket。它"从不解释 Pi、会话、worker 或生命周期载荷"。空置时自动退出
- server（`src/experimental/server.ts`）：默认目录 `~/.pi/server`，`ensurePrivateServerDirectory` 权限 `0o700`，`acquireServerProfile` / `activateServer` / `ServerLifetime` / `ServerProfile`；锁用 `proper-lockfile`；含 `RadiusRelayHost` / `RadiusRelayAuthResolver`
- **一个会话可有多个 presentation attachment**，同一连接重复 attach 幂等，每个 attachment 得到服务端生成的 `attachmentId`
- **v0.85.1 起 server/client 命令改为 source-only**（经 `pi-test.sh`），不进已发布的 npm bundle

### 接入路径与成熟度排序

| 路径 | 成熟度 | 适用 |
|---|---|---|
| 写 extension / pi-package | 最成熟、最正统 | 智能体作为 pi 的一个功能 |
| SDK `createAgentSession()` | 成熟 | 自己拥有 agent loop 与会话 |
| `--mode rpc` + `RpcClient` | 成熟但受限 | 进程隔离、非 Node 语言驱动、**单客户端、纯 stdio** |
| experimental server/client/protocol | experimental、无认证、source-only | 只作为知识参考 |

---

## 二、同类项目对照

### 形态最接近本架构的

| 项目 | 数据层 | 服务层 | 壳子 | 可远程 | 多实例共享一个数据层 |
|---|---|---|---|---|---|
| **OpenCode**（sst/opencode，MIT，TS） | XDG `~/.local/share/opencode` + SQLite/Drizzle + 全局文件锁 | `opencode serve` headless HTTP + OpenAPI 3.1 + SSE | TUI 本身即客户端；另有 desktop / web / IDE 插件 | 是（`--hostname` / basic auth / `--cors`） | 文档支持多客户端；单机单数据目录 |
| **Codex CLI app-server**（openai/codex，Apache-2.0，Rust） | `$CODEX_HOME`、`history.jsonl`、`sqlite_home` 状态库 | `codex app-server`：JSON-RPC 2.0 over stdio / **WebSocket** / unix socket | `codex --remote ws://host:port`（TUI 自己）+ VS Code 扩展 | **第一方支持**：`codex --remote wss://remote-host:4500 --remote-auth-token-env ...` | 未文档化（各 app-server 共享 `$CODEX_HOME` 属推断） |
| **OpenHands Agent Canvas**（MIT，TS） | 按 workspace 的会话持久化 | Agent Server = HTTP/WebSocket，事件经 WS 流式 | Agent Canvas（`@openhands/agent-canvas`），内置 backend 列表 | **是**，文档原话 "Any Agent Canvas frontend can connect to any Agent Canvas backend"；backend = 显示名 + host URL + API key | 一个 Canvas 挂多个 backend |
| **LangGraph / LangSmith Agent Server** | Postgres 存 assistants/threads/runs/cron + checkpoint + store；Redis 只做 pub/sub 与流式信令 | REST Agent Server + 独立 queue worker | 任意 HTTP 客户端；官方 Agent Chat UI（Next.js，填 Deployment URL + Assistant ID） | 是，按构造即可 | **明确文档化**：stateless 容器，`queue.enabled: true` 拆分 API 与 worker，共享 Postgres + Redis |
| **Letta Code**（Apache-2.0，TS） | Letta Cloud 持记忆/身份/会话 | `letta server` App Server，`--computer-name` 注册机器 | TUI / 桌面 / chat.letta.com / Slack 等渠道 | 是 | **是**：多台机器起 harness 接同一份云状态，`letta -p --agent <id> --computer "work-laptop"` 路由 |
| **n8n queue 模式** | 一个 Postgres（队列模式不支持 SQLite） | main + N 个 worker，经 Redis 派发 | 编辑器 UI 由 main 进程提供 | worker 可在别的机器 | **是**，但 UI 绑在 main 上 |

### 值得单独记下的实现

- **Roo Code 的 `TaskHistoryStore`** — 唯一有明确文档与测试（`TaskHistoryStore.crossInstance.spec.ts`）的"多个实例共享一个磁盘数据层"实现：每个 task 一个 `history_item.json` 放在 `globalStorage/tasks/<taskId>/`，单个 `_index.json` 作索引，跨进程安全靠 `safeWriteJson` + `proper-lockfile`，跨实例响应靠 `fs.watch`，并有 index 与磁盘的 reconcile 逻辑。（该仓库已 archive，2026-05。）
- **Cline** — `apps/vscode/proto/cline/*.proto`（`task` / `state` / `ui` / `web` / `checkpoints` / `mcp` / `worktree`）+ `protobufjs` + `better-sqlite3`。**边界存在但守护进程不存在**：host 就在 VS Code 扩展宿主进程里。这是"分层边界画好了但没拆进程"的典型。
- **Happy**（slopus/happy，MIT，TS）— 反向取舍：agent 留在本机，中继与存储是 Happy Server（端到端加密，服务端只有密文，可自托管为单 Docker + PGlite）。多个薄客户端（iOS/Android/web/macOS/CLI）驱动本机 Claude Code / Codex。
- **Omnara**（Apache-2.0，Go）— 已从"手机遥控 Claude Code"转向托管式 agent 控制面：状态原子提交 Postgres，崩溃/重启/断连后自动恢复，机器可插拔（Blaxel / Daytona / Modal / Unikraft / 自有笔记本或 VM），REST API 在 `/api/v1`。

### 协议标准

| 标准 | 定位 | 传输 | 关键性质 |
|---|---|---|---|
| **ACP**（Agent Client Protocol，Zed，Apache-2.0） | 编辑器 ↔ agent | JSON-RPC 2.0，通常 stdio（agent 作为 client 的子进程） | 分工明确：**客户端（编辑器）持有 fs / terminal / 权限**，agent 持有模型循环与会话状态。方法：agent 侧 `initialize` / `authenticate` / `session/new` / `session/prompt` / `session/load` / `logout` / `session/set_mode`，通知 `session/cancel`；client 侧 `session/request_permission` / 可选 `fs/read_text_file` / `fs/write_text_file` / `terminal/create|output|release`。~50 个 agent 已接入。**无一数据层共享概念**，`session/load` 是唯一的持久化钩子 |
| **AG-UI**（MIT，TS） | agent ↔ 用户界面 | 传输无关（SSE / WS / webhook），另有参考 HTTP 实现 | ~16 种标准事件类型。定位原话：MCP 给 agent 工具、A2A 管 agent 间，AG-UI 把 agent 带进用户界面 |
| **MCP** | agent ↔ 工具/上下文 | **恰好两种标准绑定**：stdio（换行分隔 JSON，客户端启动的子进程）、Streamable HTTP（POST 到单一端点，回复为 JSON 对象或请求作用域的 SSE 流） | 对字节流传输（unix socket、TCP），规范建议**复用 stdio 的分帧**，"只有进程生命周期规则是标准流特有的" |
| **A2A**（Apache-2.0） | agent ↔ agent | JSON-RPC 2.0 over HTTP(S) + Agent Card 发现 + SSE 流式 + 推送通知 | agent 间协作，不暴露内部状态、记忆、工具 |

**ACP 与本架构的关键差异**：ACP 是"**客户端**拥有环境"（编辑器持有 fs/terminal，agent 反过来请求客户端），而 pi 与 ucode 是"**核心层拥有环境"（工具在核心层所在主机执行）。这两个哲学不能混用。ucode 选后者，因为远程壳子的动机通常是"环境在那台机器上"；只把**人类交互**委托给控制层。

---

## 三、失败案例与共同失败模式

| 项目 | 状态 |
|---|---|
| **Vibe Kanban**（BloopAI，Apache-2.0，Rust+React） | 已宣布 sunsetting（尽管仍有提交）。架构其实对：Rust 后端 + web UI + SQLite + 多 agent 支持 + MCP server |
| **Crystal**（stravu） | 2026-02 deprecated，转向 Nimbalyst（Electron，git-worktree 隔离） |
| **Terragon** | 2026-02-09 关停 |
| **Flowise** | 仓库已 archive |
| **Continue.dev**（Apache-2.0） | 仓库只读冻结在 2.0.0，README 原话 "no longer actively maintained" |
| **Coder AgentAPI** | 已弃用。但它是最纯粹的"在 CLI agent 前面加一层 HTTP API"：`agentapi server -- claude`，端口 3284，`GET /messages` / `POST /message` / `GET /status` / `GET /events`（SSE）/ `/openapi.json` / `/chat`，`--allowed-hosts` 默认只允许 localhost |
| **Letta 的 V1 API server**（`letta-ai/letta`） | 退役进 `archive` 分支 |
| **Aider** | 从未长出 server 模式；`--browser` 只是同进程的本地浏览器 UI，明确标注 experimental |

**共同失败模式**：以"本地启动器"形态出现的编排产品（Vibe Kanban、Crystal、Conductor、Terragon），agent 都是 CLI 子进程，于是状态散落在 git worktree 加一个本地 DB 里；远程 UI 是事后补的，或者根本没有。结果要么转向云沙箱（Conductor），要么关停。

**对本架构的启示**：三条。

1. **数据层必须先定，且必须是单一真相。** 状态散落是上述项目的病灶。
2. **远程能力不能后补。** 后补意味着协议要重设计。ucode 的做法是 v1 就在协议 C 里留好 `auth` 字段、在信任矩阵里留好 `untrusted` 行，即使 v1 不实现。
3. **生命周期是真实的产品问题。** 半数项目的死因不在技术。

---

## 四、事实来源与不确定性

### 已验证（直接抓取官网、仓库、文档、package.json 确认）

pi.dev 首页与 `/docs` 各页、`pi.dev/packages`、`pi.ai`、`earendil.com`、GitHub API、各文件的 raw 内容（README / CHANGELOG / `package.json`）、以及第二节中每个项目的官方文档或仓库文件。

### 属于推断（未直接验证）

| 推断 | 依据 | 影响 |
|---|---|---|
| `pi server` / `pi client` 子命令存在 | v0.85.1 的 changelog 写 "server/client commands are now source-only through `pi-test.sh`"，且存在 `src/cli/experimental` 目录 | 无（本架构不复用它） |
| 实验性 server 是 Earendil 托管产品 Radius 的底座 | `src/experimental/server.ts` 内的 `radius-relay.ts` / `RadiusRelayHost` / `RadiusRelayAuthResolver`，加 Radius 自身的宣传 | 无 |
| Codex 的两个 app-server 进程能否安全共享 `$CODEX_HOME` | 未文档化 | 无 |
| OpenCode 的多实例并发 | 由单一 XDG 数据目录 + SQLite/Drizzle + `Flock.setGlobal` 推断，无文档明说 | 无 |
| OpenHands 会话持久化的具体后端 | 未读 persistence 指南正文 | 无 |

### 刻意未采用的数字

pi 仓库的 star / fork / 周下载量在本次调研中读出**异常偏高**（对一个 2025-08 创建、约 13 个月的仓库而言），未做独立交叉验证，因此**本附录不引用任何 star 数或下载量**。同理，`pi.dev/packages` 的 5687 是本附录唯一引用的数量，且已标注为"自报"。

**理由**：这些数字不承载任何架构决策。技术上被夸大或低估都不影响 ADR 的内容，但如果不标注就写进文档，会被误当作可信依据引用。
