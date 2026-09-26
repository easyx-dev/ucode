# spike · 承重假设验证

验证 ucode 架构中依赖基座（pi）行为的**承重假设** `V-1`~`V-10`。结论回写 [../docs/spec/03-假设与验证.md](../docs/spec/03-假设与验证.md) 与 [../docs/spec/01-架构.md](../docs/spec/01-架构.md)。

## 环境

- Node v24.4.1（原生跑 `.ts`）
- `@earendil-works/pi-coding-agent` **0.87.1**（最新稳定版）
- 供应商：本地 OpenAI 兼容端点，model `deepseek-v4-flash`；**配置从 `spike/.env` 读取**（见 `.env.example`，可用环境变量覆盖）
- `node-pty`（仅 V-7 用）

> **注**：原计划用假供应商以保证可重跑、零成本；按指示改用真实供应商，因此带模型调用的脚本（`smoke` / `v2` / `v1` / `v4` / `v8` / `v10`）会消耗额度，不可无限重跑。

## 运行

```bash
cd spike
npm install
cp .env.example .env     # 填入 SPIKE_API_KEY 等（.env 已 gitignore）

node smoke.ts              # 冒烟：供应商与 SDK
node v2-persistence.ts     # V-2 持久化能否被接管
node v1-append-only.ts     # V-1 追加性 + V-5 迁移写回
node v3-tolerance.ts       # V-3 容忍非会话文件
node v4-plugin-runtime.ts  # V-4 插件运行时嵌入（非 pi 宿主）
node v6-workspace-query.ts # V-6 工作区/Git 查询
node v7-pty.ts             # V-7 PTY 通道（需 node-pty）
node v8-pending-interaction.ts # V-8 会话持久化与续跑
node v9-subprocess-hook.ts # V-9 子进程 hook 协议
node v10-reader.ts         # V-10 多实例文件跟随（会 spawn v10-writer.ts）
```

结果写入 `results/*.json`（已 gitignore）。

## 探针

| 文件 | 覆盖 |
|---|---|
| `smoke.ts` | 供应商可用、SDK 基本用法 |
| `v2-persistence.ts` + `v2-child.ts` | A 基线 / B `PI_CODING_AGENT_DIR` / C `+PI_CODING_AGENT_SESSION_DIR` / D 显式 `SessionManager.create(cwd, dir)` / E `inMemory` |
| `v1-append-only.ts` | Part A 真实两轮对话的追加性；Part B 全部"修改类" entry 的追加性；Part C = V-5 迁移写回 |
| `v3-tolerance.ts` | 会话桶内放目录 / `.json` / `.lock` / 非法 `.jsonl`，验证 list / open / findById |
| `v4-plugin-runtime.ts` + `fixtures/plugin-a\|b.ts` | 在自有 SDK 宿主加载两个 `.ts` 插件：注册工具、事件订阅、跨插件 `pi.events` |
| `v6-workspace-query.ts` | 文件树（mtime）、分页 Git 日志、变更筛选 |
| `v7-pty.ts` | `node-pty`：字节流、`resize`、信号 |
| `v8-pending-interaction.ts` | `dispose()` 后重开同一会话文件并续跑 |
| `v9-subprocess-hook.ts` + `fixtures/hook-decide.js` | stdin 一行 JSON → stdout 一行 JSON 的 hook 协议（allow/deny/ask） |
| `v10-reader.ts` + `v10-writer.ts` | `fs.watch` + 轮询兜底跟随追加 |

关键机制（读 pi 源码得到）：`SessionManager` 会把 entry **缓冲到首个 assistant 消息到达才落盘**（避免写半轮）；因此"修改类" entry 的追加性必须在**已落盘的真实会话**上测。

## 结论

| 假设 | 结论 | 证据 |
|---|---|---|
| **V-1 严格只追加** | **成立**（v3 会话） | 两轮对话 + 全部修改类 entry，**全部前缀延伸、大小单调、inode 不变** |
| **V-2 持久化可接管** | **成立** | `PI_CODING_AGENT_DIR` 生效；`SessionManager.create(cwd, dir)` 显式接管会话目录；`inMemory()` 不落盘；**无旁路双写** |
| **V-3 容忍非会话文件** | **成立** | 桶内放子目录 / `index.json` / `x.lock` / 非法 `bad.jsonl`，`list` 忽略、`open` / `findById` 正常 |
| **V-4 插件运行时嵌入** | **成立** | 自有 SDK 宿主加载两个 `.ts` 插件：无错误、工具被实际调用、`tool_call` 订阅触发、跨插件总线成功 |
| **V-5 迁移不写回** | **推翻** | 加载 v2/v1 会话即**原地重写**为 v3：前缀断裂、**inode 不变** |
| **V-6 工作区/Git 查询** | **成立**（自建） | 文件树 + 分页 Git 日志 + 变更筛选，毫秒级构建；pi 不提供，需核心层自建并经通道暴露 |
| **V-7 PTY 通道** | **成立** | `node-pty`：字节流、`resize(120,40)`（`stty size`=`40 120`）、信号均正常 |
| **V-8 待决交互介入点** | **部分成立** | 会话状态可持久化、`dispose()` 后重开续跑；**未覆盖**：释放等待态（pi 无现成挂起态，需自建状态机） |
| **V-9 子进程 hook** | **成立** | 协议往返正常，allow/deny/ask 三态正确，延迟约 20ms |
| **V-10 文件跟随可靠性** | **成立**（需轮询兜底） | 20 次追加中 `fs.watch` 只报 19 次，30ms 轮询补齐；无重写 |

## 补充发现

1. **宿主差异（V-2）**：`PI_CODING_AGENT_SESSION_DIR` **在 CLI 生效、在 SDK 不生效**；SDK 要接管会话目录必须显式传 `SessionManager.create(cwd, sessionDir)`。`--session-dir` 在 CLI 生效。
2. **迁移是原地重写（V-5）**：inode 不变，因此**"检测 inode 变化"不足以发现整体替换**——须检测内容/大小不连续（或校验前缀）。
3. **追加式是分段的**：同版本会话严格只追加；**跨版本（旧 header）在首次加载时被重写一次**，之后恢复追加。
4. **`fs.watch` 会合并/丢事件（V-10）**：必须轮询兜底。
5. **`node-pty` 打包坑（V-7）**：npm 安装后 `prebuilds/<platform>/spawn-helper` 缺执行位，需 `chmod +x`，否则 `posix_spawnp failed`。

## 对架构的影响

- `V-1`/`V-2`/`V-3`/`V-4`/`V-6`/`V-7`/`V-9`/`V-10` 对应的 `【候选】` 可升 `【已决】`；`V-8` 部分确认（状态可续跑，释放态需自建）；`V-5` 推翻。
- `V-5` 推翻带来两条实现约束：
  1. 迁移必须作为**显式事件**通知全体 attachment 重新全量同步（[01 §4.5](../docs/spec/01-架构.md) 已有此条）。
  2. 跟随者**不能只靠 inode 变化**检测整体替换（[01 §3.12](../docs/spec/01-架构.md) 已据此修订）。
- `V-8` 的未覆盖部分：无人值守的"释放等待态"需核心层自建状态机（[01 §4.11](../docs/spec/01-架构.md) 已标注）。
