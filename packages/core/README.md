# @ucode/core

协议 C 的服务端：握手、attachment、会话运行时、交互中转、工具闸门与各功能域。headless，不渲染界面。

## 职责

- 承载 agent 本体：会话运行时驱动基座 agent loop，把基座事件转成协议 C 的服务端消息。
- 握手与授权：按绑定声明的信任级别与能力，回告实际授予什么（`welcome` / `rejected`）。
- 工具闸门：任何通路的工具执行都要过信任矩阵 + 自主级别，批准权归 `ui-broker`。
- 交互中转：把需要人类决策的请求路由到能承载它的 attachment；承载不了就降级而非挂起。
- 各功能域见下表。
- **不做**：不知道传输是什么（绑定层把消息解出来交给它）、不渲染界面、不直接读写会话文件（走 `@ucode/store`）。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `createCore`、`handleHello`、`createToolGateExtension`、`UiBroker`、`createExtensionUiContext`、各功能域工厂 |
| 类型 | 同上 | `Core`、`CoreConfig`、`AttachConnectionOptions`、`ConnectionHandle`、`CoreBus`、`AttachmentView` |

## 用法

```ts
import { createCore } from "@ucode/core";

const core = await createCore({ dataDir, cwd: process.cwd(), defaultAutonomy: "confirm" });

// 绑定层把解出来的原始消息交给核心层；核心层不知道背后是哪条传输
const handle = core.attachConnection({
  binding: "stdio",
  trustLevel: "implicit",
  send: (message) => writeToPeer(message),
});
await handle.receive(parsedClientMessage);

await core.close(); // 释放 owner 租约、dispose 所有会话运行时
```

## 功能域

每个域各自成目录，以"代码 + 测试 + 真实模型验证"三件套落地。

| 目录 | 职责 |
|---|---|
| `goal/` | 目标模式：持久目标 + 每轮独立校验 + 自动续跑 + 用量上限 |
| `hooks/` | 生命周期钩子：把子进程钩子挂到基座事件（SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop） |
| `subagents/` | 子智能体：Markdown + frontmatter 定义，前台阻塞或后台通知 |
| `tasks/` | 任务调度：无状态调度器每 tick 读盘，定时/cron、空闲窗口、会话绑定、保持唤醒 |
| `undo/` | 按轮撤销文件改动：在 `tool_call` 前记录原像 |
| `memory/` | 项目级持久记忆：起始时注入索引 + 注册 `memory` 工具 |
| `wiki/` | Wiki 生成与复用：读取过滤 + 预算上限 |
| `insights/` | 用量聚合、支持包导出、迁移、脱敏 |
| `marketplace/` | 插件安装/卸载：只读源、带来源、不覆盖 |
| `plugins/` | 已安装资源发现与上报（加载由基座 `DefaultResourceLoader` 负责） |
| `import/` | 外部 Agent 资源导入（skills / commands / subagents / context / mcp） |
| `ssh/` | SSH 连接注册表（不存密钥）+ 远端命令执行 |

内部支撑：`util/`（YAML frontmatter 子集解析）、`testing/`（录制式假模型供应商，测试用，**不经 barrel 导出**）。

## 依赖位置

依赖 `@ucode/protocol`、`@ucode/store`、`@ucode/data-layer-spec`、`@ucode/branding`；外部依赖 `@earendil-works/pi-coding-agent`、`jiti`、`node-pty`、`typebox`。

被依赖：只有 `@ucode/cli` 直接依赖本包。`web` / `desktop` / `tui` **不得**依赖它（它们只走 `@ucode/sdk`，反向验收会拦）。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/core` 条目。

## 关键约束

- `CoreConfig.dataDir` **必填**：核心层启动即 `openStore`，没有数据层目录就不成立。
- 核心层不得绕过 `store` 读写会话文件。
- **子智能体继承工具闸门**（不是绕过批准的后门），且不挂记忆与子智能体工具（防递归），有 `maxTurns` 护栏。
- **无人值守的待决交互必须持久化**：基座没有现成挂起态，本层自建状态机并落盘 `ui.pending` / `ui.resolved`，应答后转达 agent。
- 交互超时或无人承载时，给 agent 追一条"按最佳判断继续"；用户主动取消不触发。
- `hooks` 只从可信数据层读 `hooks.json`，**绝不读项目本地 hooks**——否则 clone 一个仓库就会执行其中定义的钩子。
- 对端声称自己可信等于没有信任模型：信任级别只由绑定声明，本层只查表。

## 开发

```bash
pnpm -F @ucode/core typecheck
pnpm test    # 核心层测试用 packages/core/src/testing 的录制式假供应商，确定性、零成本、不依赖网络
```

开发态直跑 `src/*.ts`，无需构建。
