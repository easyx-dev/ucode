# 阶段 7a · 接内置 MCP（含配置管理 UI）

> 计划母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 7a。
> 本文是 7a 的落地细化，只覆盖本阶段；7b（`tool_search`）/ 7c / 7d 不在此文。

## 目标

把 pi 0.99 内置的 MCP 扩展接进会话装配层：`build` 模式按 `$APP_HOME/agent/mcp.json`
连接 MCP 服务器，`plan` / `ask` 不加载该扩展；MCP 工具走 pi 的 `tool_call` 管线，
按 MCP annotations 判定读 / 写，未命中规则的 `mcp__*` 调用走审批。
同时在设置页提供 MCP 服务器的增删改，写回同一个 `mcp.json`。

## 已锁定决策

- 配置来源只有一份：`$APP_HOME/agent/mcp.json`（用户级）。不做项目级 `.pi/mcp.json`，不做 OAuth。
- 工具暴露沿用 pi 默认 `codemode`：MCP 工具经 codemode 脚本调用，不进模型工具声明；
  本阶段 UI 不暴露 `deferred`（属 7b）。
- 权限：`readOnlyHint === true` 的 MCP 工具默认放行，其余默认审批；显式规则与会话恒允照常覆盖。
- `plan` / `ask` 不加载 MCP 扩展——它连接成功会主动激活 `codemode`，绕过只读白名单。
- P0 鉴权暂缓不是本阶段前置；落地前服务仍只能在本机 / 可信环境使用。

## 改动点

### 1. 契约`@ucode/contracts`

新增 `packages/contracts/src/mcp/input.ts` 与 `output.ts`，`index.ts` 导出。

- 常量（放 `constants.ts`）：`MCP_EXPOSURES = ["codemode", "direct", "hidden"] as const`、
  `MCP_TRANSPORTS = ["stdio", "http"] as const`、`DEFAULT_MCP_EXPOSURE = "codemode"`、类型别名。
- `mcpServerSchema`：按 `type` 判别的联合
  - `stdio`：`command`（必填）、`args?`、`env?`（`Record<string,string>`）、`cwd?`
  - `http`：`url`（必填）、`headers?`（`Record<string,string>`）
  - 公共：`name`（`^[A-Za-z0-9][A-Za-z0-9._-]*$`，避免与 `mcp__<server>__<tool>` 分隔符冲突）、
    `enabled`（默认 `true`）、`exposure`（默认 `codemode`）、`timeout?`（秒，正整数）
- `mcpListInputSchema`：无参数（保留 zod 对象以便后续过滤）。
- `mcpUpsertInputSchema = mcpServerSchema`：按 name 覆盖写入。
- `mcpDeleteInputSchema = { name }`。
- 输出：`McpServerView`（与入参同形，去掉内部字段）、
  `McpListResponse = { servers: McpServerView[]; configPath: string; errors: string[] }`、
  `McpWriteResponse = { server: McpServerView; configPath: string }`、
  `McpDeleteResponse = { removed: boolean; configPath: string }`。
- 错误码：复用 `invalidConfig`（`mcp.json` 解析失败）、`invalidRequest`（字段校验）。
  不为单个文件操作新增错误码。

`*Request` / `*Input` 成对由 `scripts/verify` 的 contracts 校验兜底。

### 2. server · MCP 配置读写`server/src/agent/mcp/`

- `config.ts`
  - `env.mcpConfigPath` = `resolve(env.agentDir, "mcp.json")`（文件名常量 `MCP_CONFIG_FILENAME` 放 `server/src/constants.ts`）；
    `mcpConfigPathOf(agentDir)` 供装配层按会话实际 agentDir 取路径（评测 / 测试会覆盖它以隔离）。
  - `readMcpConfig()`：读文件 → JSON 解析 → zod 校验 `{ mcpServers: Record<name, mcpServerSchema> }`；
    文件缺失返回空；解析 / 校验失败返回 `{ servers: [], errors: [...] }`，不抛错（与 pi 的 `errors` 语义一致）。
    保留 `autoEnableCodemode` 与未知顶层键，写回时不丢。
  - `writeMcpServer(server)` / `deleteMcpServer(name)`：读原始 JSON 对象，只改 `mcpServers` 下的一项，
    其余原样保留；坏 JSON 按空配置处理（写操作即修复路径，不抛错）；2 空格缩进、UTF-8 无 BOM、`tmp + rename` 原子落盘。
  - 写入时建模字段以视图为准，未建模字段（`toolExposure` / `oauth` 等）从原条目继承，不静默丢弃。
- `index.ts`
  - `readMcpConfigForLoader()`：给 `createMcpExtension({ loadConfig })` 用；转成 pi 的
    `LoadedMcpConfig`（`servers: [{ name, config, source, scope: "global" }]`、`autoEnableCodemode`、`errors`）。
    校验走本服务子集，但交给 pi 的是**原始条目**（未建模字段原样透传）；
    自定义 `loadConfig` 的目的是「只认这一份文件」，排除 pi 默认的 `<project>/.pi/mcp.json`。
  - `mcpExtensionForMode(mode, agentDir)`：`build` 返回按 `mcpConfigPathOf(agentDir)` 读配置的工厂，
    `plan` / `ask` 返回 `undefined`；`startupWaitMs` 用默认 10s。

### 3. server · 会话装配接入

- `session-config.ts`：
  - `extensionFactories` 追加 `...(mode === "build" ? [mcpExtensionForMode(mode, agentDir)] : [])`，
    `agentDir` 取 `input.agentDir ?? env.agentDir`。
  - 现有的 `createPermissionExtension` / `createCodemodeExtension` 不变。
- `core/pool.ts`：`createAgentSession` 之后补 `await session.bindExtensions({})`（仅 `build` 模式）。
  原因：MCP 扩展在 `session_start` 时才连接服务器，不调 `bindExtensions` 不会触发；codemode 不依赖它。
  连接在后台进行，首个 prompt 最多等 `startupWaitMs`（10s）。`plan` / `ask` 无 MCP 扩展，不必调用。

### 4. server · 权限接入 annotations

- 纯函数（`agent/permissions/engine.ts` 或新的 `mcp-rules.ts`）：
  `mcpPermission(annotations): { action, note }` —— `readOnlyHint === true` → `allow`，
  `destructiveHint === true` → `ask`（注明「可能删除 / 覆盖」），否则 `ask`。
- `permissions/extension.ts`：
  - 从 `pi.getAllTools()` 建一次按 name 的索引，拿到 `ToolInfo.annotations`；
  - 规则判定 `verdict.rule === undefined` 且工具名以 `mcp__` 开头时，用上面的纯函数兜底；
    命中显式规则（含本会话恒允）则按规则结果走，保证「最后命中者胜」不变。
  - 审批的 `subject` 用入参 JSON 的截断摘要（比空串更有上下文），`scope` 取工具名，
    `allow_session` 追加 `{ tool: "mcp__<server>__<tool>", pattern: "*", action: "allow" }`。
- `defaults.ts` 不加 `mcp__*` 静态规则：兜底由扩展里的 annotations 分支负责，避免规则表猜测读写。
- `plan` / `ask` 即使未来误加载 MCP 扩展，只读白名单 + `deny` 规则仍是第二道闸门。

### 5. server · 路由`server/src/routes/mcp/index.ts`

- `POST /api/v1/mcp/list` → `McpListResponse`
- `POST /api/v1/mcp/upsert` → `McpWriteResponse`
- `POST /api/v1/mcp/delete` → `McpDeleteResponse`
- 入参走 `jsonBody(...)`，出参 `ok(...)`，响应生产点显式标注契约类型；在 `server/src/index.ts` 注册。
- 改动 `mcp.json` 不影响已建会话实例：下一次 `pool.ensure`（模式切换 / 空闲回收 / 服务重启）才重新加载。
  路由响应用于前端刷新列表，不主动重建会话。

### 6. web · 设置页 MCP 管理

- `apps/web/src/hooks/use-mcp-servers.ts`：拉取 `mcp/list`，暴露 `servers` / `errors` / 增删改后的 `refresh`。
- `apps/web/src/components/settings/settings-mcp.tsx`：服务器列表 + 新增 / 编辑表单 + 删除确认 + 启用开关。
  - 表单字段随 transport 切换：stdio → 命令 / 参数（每行一条）/ 环境变量（KEY=VALUE）/ 工作目录；
    http → 地址 / 请求头（KEY=VALUE）。
  - 编辑时 name 锁定（重命名 = 删除 + 新增），enabled 与 exposure 可改。
  - 该区块直接调 `mcp/*` 接口即时落盘，**不并入 config 的 draft**（`mcp.json` 与 `config.json` 是两份文件、
    两套持久化时机）。`settings-body.tsx` 新增「MCP」区块，沿用 `Section` + `Separator` 结构。
- 复用现有基础组件（`Button` / `Input` / `Switch` / `Dialog` 等），不新造样式。

### 7. i18n 与 CHANGELOG

- `packages/i18n/src/locales/ui/{zh-CN,en}.ts` 补 MCP 区块全部文案（key 用中文原文），两份齐平。
- 服务端只出中文兜底 `message`，不本地化。
- `CHANGELOG.md`「新增」记：MCP 接入、`mcp/*` 接口、设置页管理、依赖不变（MCP 由 pi 内置，无新增依赖）。

## 测试方案

| 编号 | 层 | 用例 | 预期 |
| --- | --- | --- | --- |
| MCP-01 | L2 | `readMcpConfig` 读缺失 / 合法 / 坏 JSON | 分别空 / 解析成功 / 带 `errors` 不抛 |
| MCP-02 | L2 | upsert → delete 往返 | 文件内容正确、保留未知顶层键、原子写 |
| MCP-03 | L2 | `mcpPermission` 三态 | readOnly → allow；destructive / 未标注 → ask |
| MCP-04 | L3 | 规则命中 mcp 工具时 | 显式 allow / deny 覆盖 annotations 兜底；恒允后可放行 |
| MCP-05 | L3 | `mcpExtensionForMode` | build 有工厂，plan / ask 为 undefined |
| MCP-06 | L5 | 设置页增删改伺服器 | 列表刷新、`mcp.json` 内容正确 |
| MCP-07 | L4 | 真实 MCP server（文件系统） | build 下经 codemode 调用只读工具通过；plan / ask 不可见（手工冒烟，可选） |

测试文件放 `server/src/agent/mcp/__tests__/config.test.ts`、
`server/src/agent/permissions/__tests__/mcp-rules.test.ts`，断言用 `node:assert/strict`。

## 验收标准

- `pnpm check` 全绿（含新增单测与 6 项约定校验）。
- `build` 会话能连上 `mcp.json` 的服务器；`plan` / `ask` 的工具集不含任何 `mcp__*`。
- MCP 只读工具无需审批；写类工具弹审批，「本会话恒允」后同类工具放行。
- 设置页可增删改 MCP 服务器，落盘到 `$APP_HOME/agent/mcp.json`；坏配置以可读错误呈现、不崩溃。

## 已确认的取舍

1. UI **暴露** `exposure` 选择（codemode / direct / hidden），默认 `codemode`。
2. `env` / `headers` 的值**明文回显**：它们常是 `${TOKEN}` 引用，与 `mcp.json` 保持一致、编辑简单。
3. 配置改动**下一次 `ensure` 生效**：写盘后不主动重建活跃会话。
4. 管理入口放**现有设置对话框内**新增「MCP」区块。

## 明确不做

- 项目级 `.pi/mcp.json`、OAuth 登录、服务器运行时启停 / 重连管理 UI。
- `tool_search` 与 `deferred` 暴露（7b）。
- `mcp.json` 的热重载（改配置即重建活跃会话）。
