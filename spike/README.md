# spike · 承重假设验证

验证 ucode 架构中依赖基座（pi）行为的**承重假设**：`V-2` / `V-1` / `V-3`，并顺带验证 `V-5`。结论回写 [../docs/spec/03-假设与验证.md](../docs/spec/03-假设与验证.md) 与 [../docs/spec/01-架构.md](../docs/spec/01-架构.md)。

## 环境

- Node v24.4.1（原生跑 `.ts`）
- `@earendil-works/pi-coding-agent` **0.87.1**（最新稳定版）
- 供应商：本地 OpenAI 兼容端点，model `deepseek-v4-flash`；**配置从 `spike/.env` 读取**（见 `.env.example`，可用环境变量覆盖）

> **注**：原计划用假供应商以保证可重跑、零成本；按指示改用真实供应商。真实供应商意味着每轮会消耗额度，脚本不可无限重跑。

## 运行

```bash
cd spike
npm install
cp .env.example .env     # 填入 SPIKE_API_KEY 等（.env 已 gitignore）
node smoke.ts            # 冒烟：验证供应商与 SDK
node v2-persistence.ts   # V-2：持久化能否被接管（5 个实验）
node v1-append-only.ts   # V-1：追加性 + V-5：迁移写回
node v3-tolerance.ts     # V-3：容忍非会话文件
```

结果写入 `results/*.json`（已 gitignore）。

## 探针

| 文件 | 覆盖 |
|---|---|
| `smoke.ts` | 供应商可用、SDK 基本用法 |
| `v2-persistence.ts` + `v2-child.ts` | A 基线 / B `PI_CODING_AGENT_DIR` / C `+PI_CODING_AGENT_SESSION_DIR` / D 显式 `SessionManager.create(cwd, dir)` / E `inMemory` |
| `v1-append-only.ts` | Part A 真实两轮对话的追加性；Part B 全部"修改类" entry 的追加性；Part C = V-5 迁移写回 |
| `v3-tolerance.ts` | 会话桶内放目录 / `.json` / `.lock` / 非法 `.jsonl`，验证 list / open / findById |

关键机制（读 pi 源码得到）：`SessionManager` 会把 entry **缓冲到首个 assistant 消息到达才落盘**（避免写半轮）；因此"修改类" entry 的追加性必须在**已落盘的真实会话**上测。

## 结论

| 假设 | 结论 | 证据 |
|---|---|---|
| **V-2 持久化可接管** | **成立** | `PI_CODING_AGENT_DIR` 生效（配置与会话一起重定向）；`SessionManager.create(cwd, sessionDir)` 显式接管会话目录；`inMemory()` 不落盘；**无旁路双写**（每个实验只在一处出现 JSONL） |
| **V-1 严格只追加** | **成立**（v3 会话） | 两轮对话 + 自定义消息/会话信息/自定义数据/模型切换/思考层级/用量/打标/历史编辑/压缩，**全部前缀延伸、大小单调、inode 不变** |
| **V-3 容忍非会话文件** | **成立** | 桶内放子目录、`index.json`、`x.lock`、非法 `bad.jsonl`，`list` / `open` / `findById` 均正常，且列表**忽略**这些文件 |
| **V-5 迁移不写回** | **推翻** | 把会话 header 版本改回 v2 / v1 后加载，文件被**原地重写**为 v3：`prefixOk=false`、**inode 不变**、大小仅变 1 字节（版本号 2→3） |

### 补充发现

1. **宿主差异（V-2）**：`PI_CODING_AGENT_SESSION_DIR` **在 CLI 宿主生效、在 SDK 宿主不生效**；SDK 要接管会话目录必须显式传 `SessionManager.create(cwd, sessionDir)`。`--session-dir` 在 CLI 生效。
2. **迁移是原地重写（V-5）**：inode 不变，因此**"检测 inode 变化"不足以发现整体替换**——跟随者必须检测内容/大小不连续（或校验前缀）。
3. **追加式是分段的**：同版本会话严格只追加；**跨版本（旧 header）在首次加载时被重写一次**，之后恢复追加。

## 对架构的影响

- `V-2` / `V-1` / `V-3` 对应的 `【候选】` 可升 `【已决】`（已在 spec 中更新）。
- `V-5` 推翻带来两条实现约束：
  1. 迁移必须作为**显式事件**通知全体 attachment 重新全量同步（[01 §4.5](../docs/spec/01-架构.md) 已有此条）。
  2. 跟随者**不能只靠 inode 变化**检测整体替换（[01 §3.12](../docs/spec/01-架构.md) 的跟随注意需据此修订）。
