# 附录 B · 实现参考

> **本附录属实现级，不是架构约束。** 它是作者在写作基准时顺手收敛出来的一套具体方案，供实现者参考或直接照做。**换掉其中任何一条都不会影响任何架构结论**，因此可以自由推翻，**不必记入 v2 的变更集**，v2 讨论时也不应把它当作前提。
>
> 判定标准：若某条内容被替换后，01–08 中某条标记为"基准"的结论会变，那么它本该写在基准里而不是这里。若有发现，请把它移出去。

## B1 数据层目录布局参考

对应基准：02 §2 的状态分类。下表是分类的一种具体落地方式。

```
~/.ucode/
├── version                     {"protocolVersion":1,"minReadableVersion":1}
├── settings.json               配置
├── models.json                 模型与供应商定义
├── auth.json                   凭据（0600，标记不进同步）
├── AGENTS.md / SYSTEM.md       全局上下文与 system prompt
├── extensions/  skills/        插件、技能
├── prompts/  themes/           提示词模板、主题
├── sessions/                   会话，按项目路径分桶
│   └── --<escaped-cwd>--/<timestamp>_<session-id>.jsonl
├── cache/                      派生数据（含会话索引），可安全删除
├── locks/                      全局锁
└── logs/                       日志
```

文件名与 `sessions/` 的路径转义规则沿用 pi 的 agent-dir 约定（**已决**，见 02 §2；仍依赖 [假设 #2]/[假设 #3]）。这样做的收益是 `PI_CODING_AGENT_DIR=~/.ucode` 即可让 pi 生态直接读写数据层；代价是继承 pi 的格式演进。

`<timestamp>` 建议 `YYYYMMDDTHHMMSS`，使同一桶内文件按字典序即时间序。

`<session-id>` 的建议格式：只含 `[0-9a-z-]`，单调可排序（ULID，或 `<毫秒时间戳 base36>-<随机>`）。要点是**不要共享计数器**——ID 由时间戳加随机后缀生成，天然无需跨进程协调，这是目录方案相对数据库方案的一个具体收益（对比 `pi-durable` 明确不支持跨进程 ID 分配）。

## B2 会话存储机制参考

对应基准：02 §3（四条性质）与 §9（版本演进）。

### 文件形状

JSONL。第一行为版本化 header，其后每行一条记录。

```jsonc
{"type":"session","version":3,"id":"<session-id>","timestamp":"<ISO8601>"}
{"type":"message","id":"...","parentId":null,"timestamp":"...","role":"user","content":"..."}
```

记录公共字段：`type` / `id` / `parentId` / `timestamp`。`id` 与 `parentId` 构成树——分支就是指向更早记录的新子节点。

### 记录类型（沿用 pi v3）

| type | 携带 | 说明 |
|---|---|---|
| `message` | role, content | 对话消息 |
| `model_change` | provider, modelId | 切换模型 |
| `thinking_level_change` | thinkingLevel | 切换思考层级 |
| `usage` | kind, provider, model, usage | 用量 |
| `compaction` | summary, firstKeptEntryId, tokensBefore | 上下文压缩 |
| `context_edit` | targetId, replacement | 定向修改历史 |
| `branch_summary` | fromId, summary | 分支摘要 |
| `custom` | customType, data | 扩展自定义数据 |
| `custom_message` | customType, content, display | 扩展注入的消息 |
| `label` | targetId, label | 给记录打标 |
| `session_info` | name | 会话元信息 |

注意所有"修改类"操作都有对应的**追加式**记录类型（`compaction`/`context_edit`/`label`）——这是 02 §3 第 1 条的具体体现，也是 `[假设 #1]` 想要的性质。

### 游标的实现

02 §3 第 3 条要求"每条记录可导出单调递增序号"。最省事的实现：**序号 = 记录在文件中的行序号**（header 为第 0 行）。这样不必在记录里新增字段，也不修改 pi 的格式即可拿到游标。

唯一的例外是格式迁移——迁移会重写文件（这是唯一允许重写的操作），行序号可能变化。按 03 §5 的要求，此时核心层必须主动通知所有 attachment 重新全量同步。

### 两个版本号不要混

| 位置 | 含义 | 当前值 |
|---|---|---|
| `version` 文件的 `protocolVersion` | 协议 D 的版本 | 1 |
| header 的 `version` 字段 | 会话记录格式的版本 | 3（pi 的当前版本） |

必须独立演进（02 §9）。合并会导致"升一次协议版本就要重写所有会话文件"，而重写会作废全部客户端的游标。

## B3 数据层实现机制参考

对应基准：02 §4 的七条不变量与 §5 的 owner 语义。以下是"如何做到"。

| 不变量 | 参考做法 |
|---|---|
| 非追加写必须原子（§4.2） | 写临时文件 → fsync → rename。追加写走 `O_APPEND`，不需此约束 |
| 派生数据必须可丢弃（§4.3） | `cache/` 下的索引只是加速；启动时扫描 `sessions/` 与索引对账，以磁盘为准修正。参考 Roo Code 的 `TaskHistoryStore`（`_index.json` + 单任务 JSON 文件 + reconcile），它是这个模式最完整的公开实现 |
| 崩溃后可恢复（§4.4） | 尾部若非完整行则截断到最后一个换行处。截断是唯一允许的原地写，且只发生在已知损坏的尾部、本实例持写权时 |
| 危险文件系统上拒绝（§4.5） | 检查路径是否落在已知的云同步目录下；`statfs` 判断文件系统类型是否为 NFS/SMB。命中则拒绝启动并给出明确错误 |
| 版本前向拒绝（§4.6） | 读 `version` 文件，`protocolVersion` 高于自身则拒绝启动或转只读 |
| 路径安全（§4.7） | 派生路径拒绝绝对路径与 `..`；拒绝指向数据层之外的符号链接；转义后的目录名超长时截断并附哈希后缀 |

### owner 的竞争与存活

- 用目录锁（`proper-lockfile` 风格）+ **心跳 mtime**：owner 定期 touch 锁文件以声明存活
- 心跳超时（可配，量级为分钟）后其他实例可判定原 owner 已死
- 抢占流程：取全局锁（`locks/`）→ 校核心跳确实超时 → 处置尾部（§4.4）→ 取得 owner
- 优雅退出（SIGTERM）时主动释放；异常退出靠心跳超时兜底

### 多实例跟随的实现要点

对应基准 02 §7。跟随同一文件时有四个坑：

1. **部分行**：观察到增长后只解析到最后一个完整换行，余下留缓冲。不可假设一次读取得到的尾部是完整行。
2. **变更通知不可靠**：`fs.watch` 会漏事件（合并、丢失、文件被替换）。必须有轮询兜底，间隔可以稀疏，因为通知是主路径。
3. **整体替换**：文件被替换（而非追加）时偏移失效。基准规定会话文件只追加，所以替换只可能来自迁移或人工操作——检测 inode 变化就重读全文件。
4. **迁移后的游标**：见 B2 末节。

## B4 协议 C 消息与清单参考

对应基准：03 §3–§6。以下是消息形状与清单的一种具体方案。

### 握手

```jsonc
// 控制层 → 核心层
{ "type":"hello", "protocolVersion":1, "clientId":"...", "clientKind":"web",
  "binding":"stdio", "trustLevel":"implicit", "capabilities":[...],
  "auth":null, "resume":{"sessionId":"...","fromSeq":1234} }

// 核心层 → 控制层
{ "type":"welcome", "protocolVersion":1, "coreId":"...",
  "capabilities":[...], "grantedCapabilities":[...],
  "sessions":[{"id":"...","title":"...","status":"..."}] }
```

`capabilities` = 绑定声明的承载能力；`grantedCapabilities` = 核心层按信任矩阵实际授予的能力。两者的分离是 03 §3 第 1 条。

### 响应形状

```jsonc
{ "type":"response", "id":"...", "command":"...", "success":true,  "data":{} }
{ "type":"response", "id":"...", "command":"...", "success":false, "error":{"code":"...","message":"..."} }
```

**解析失败**返回 `command:"parse"` 且**无 `id`**（无法得知 `id`）。控制层必须能处理这种情况（03 §4）。

### 命令清单

建议直接采用 pi 的 rpc 命令集——它是实际使用中收敛出来的，`steer` / `follow_up` / `clear_queue` 这类命令不是设计出来的而是被需要出来的。

| 类别 | 命令 |
|---|---|
| 会话 | `session.create` `session.list` `session.get_state` `session.get_entries` `session.get_tree` `session.fork` `session.clone` `session.set_name` `session.attach` `session.detach` |
| 驱动 | `prompt` `steer` `follow_up` `abort` `clear_queue` |
| 配置 | `model.set` `model.list` `thinking.set` `compact` |
| 工具直调 | `bash` `bash.abort` |

从 pi 继承的命令，参数与返回值语义直接沿用 pi 的 rpc 命令定义，不另行规定。新增的三个：

```jsonc
{ "command":"session.attach", "id":"c1", "sessionId":"...", "fromSeq":1234 }
{ "command":"session.detach", "id":"c2", "sessionId":"..." }
→ model.list 的 data: { "models":[{"provider":"...","modelId":"...","scoped":true}], "current":"..." }
```

### 事件类型

| 事件 | 说明 |
|---|---|
| `entry_appended` | 一条记录已落盘（**权威**，携带完整记录） |
| `message_delta` | 流式增量（**非权威**） |
| `turn_start` / `turn_end` | 一轮开始 / 结束 |
| `agent_settled` | 不再有自动工作待办（**真正的完成**） |
| `usage` | 用量更新 |
| `status` | 忙闲状态 |

`message_delta` 与 `entry_appended` 的权威性区分是 03 §5 第 1 条的具体落地。`agent_settled` 与 `turn_end` 的区别是 03 §5 第 2 条。这套命名与 pi 的做法一致（pi 的增量在 `message_update`，权威在 `message_end`；`agent_end` 不等于完成）。

### 交互面

```jsonc
{ "type":"ui.request", "id":"ui-17", "sessionId":"...",
  "method":"select"|"confirm"|"input"|"editor", "params":{} }
{ "type":"ui.response", "id":"ui-17", "cancelled":false, "value":"..." }

{ "type":"ui.notify", "level":"info"|"warn"|"error", "message":"..." }
{ "type":"ui.status", "key":"...", "value":"..." }
{ "type":"ui.widget", "id":"...", "content":{} }
{ "type":"ui.title",  "value":"..." }
{ "type":"ui.set_editor_text", "value":"..." }
```

四种阻塞方法与五种通知方法沿用 pi 的 extension UI 子协议（`extension_ui_request` / `extension_ui_response`）。沿用它的理由与命令清单相同：这是实际使用收敛的结果，且它证明"交互面必须是一等公民"在真实系统里成立。

## B5 绑定分帧与认证参考

对应基准：04 §6、§7。

| 绑定 | 传输 | 分帧 |
|---|---|---|
| `stdio` | 标准输入输出 | 行分隔 JSON（JSONL） |
| `rpc` | unix socket（默认）或 TCP | 4 字节大端长度前缀 + JSON 载荷 |
| `http` | HTTP + SSE | SSE 下行 / POST 上行，按标识配对 |
| `ws` | WebSocket | 一帧一消息 |

### 为什么 stdio 与 rpc 刻意不统一

两者都面向字节流，但：

- **stdio 用 JSONL**：与 pi 的 `--mode rpc` 一致，且流可被人直接阅读、可用 `jq` 处理，调试与脚本化集成的价值很高
- **rpc 用长度前缀**：unix socket 是纯机器通道，没有人在上面肉眼调试；长度前缀彻底绕开下面的换行歧义

### 行分隔 JSON 的强制要求

**按字节扫描 `\n` 切分，禁止使用语言内置的行读取器。** 这不是风格建议：JSON 字符串里可以合法包含 `U+2028` / `U+2029`，而部分运行时的行读取器会把它们当作换行，导致消息被静默截断。pi 的文档为此明确警告不要用 Node 的 `readline`（见附录 A）。

### 暴露面检查

HTTP 与 WebSocket 绑定在启动时检查监听地址：非 loopback 且无认证配置则**拒绝启动**（04 §7 的硬约束）。

## B6 包内文件划分参考

对应基准：05 §1（包边界是基准，包内划分不是）。

```
core/src/
  index.ts            对外导出（协议 C 服务端）
  handshake.ts        握手、版本校验、能力授予
  attachment.ts       attachment 注册表、交互路由
  session-runtime.ts  包住 pi 的 agent session：订阅事件 → 转译 → 落盘 → 广播
  ui-broker.ts        交互请求的发出、超时、降级
  commands/           命令面各命令的 handler
  resources/          从数据层加载插件、技能、提示词、主题
  tools/              工具注册与执行

store/src/
  layout.ts           路径计算与转义
  session-repo.ts     记录的读写与树结构
  owner.ts            锁与心跳
  index-cache.ts      索引读写与对账
  migration.ts        版本检查与迁移
  atomic.ts           临时文件 + fsync + rename
  guards.ts           权限、危险文件系统、路径安全校验

client/src/
  connect.ts          按绑定选择并建立连接
  agent-client.ts     命令面封装
  reducer.ts          事件 → UI 状态折叠
  resume.ts           断线续传与重连
```

## B7 实施阶段建议

实现级，只是一种合理的切分。每阶段的验收条件写明"怎么知道做对了"。

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0** | 验证 06 的四条假设 | 四个可重跑脚本 + 结论。**不通就停下来重新选基座**，不要带着不确定性往下走 |
| **M1** | 数据层：不变量 + 参考实现 + 一致性测试套件 | 05 §4 的必测范围全绿；两进程抢 owner 恰好一方成功；kill 持锁进程后能被接管 |
| **M2** | 核心层 + stdio 绑定 | 纯协议客户端能完成握手 → 新建会话 → 对话 → 完整事件流 → 取回历史（即 05 §3 的 CI 验收） |
| **M3** | 交互面 + 多 attachment + 跟随 | 第二个控制层挂载收到全量重放 + 增量，且不获得应答权；高信任 attachment 断开后路由正确移交 |
| **M4** | 其余绑定 + 信任矩阵生效 | 经 HTTP 发起工具执行被拒并给出可诊断原因；HTTP 上无法承载的交互请求走降级而非挂起 |
| **M5** | Web 壳 + 断线续传 | 杀掉核心层再拉起，壳自动重连并用游标补齐，UI 不丢不重；权限弹窗在 stdio 上弹出、Web 壳只能旁观 |
| **M6** | 多实例 + 远程 | 同机两个实例指向同一数据层，writer/reader 角色正确；WebSocket 绑定启用认证 + TLS |

M0 是阻塞性的，且它的结论会影响 M1 的设计——[假设 #2] 决定数据层是"唯一真相"还是"权威副本 + 派生"。所以不要把 M0 与其他阶段并行。
