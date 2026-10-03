# 阶段 9 · 编辑历史

> 计划母文档：[`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 阶段 7「后续」与阶段 9 概要。
> 参考：[zcode 编辑历史对话](https://zcode.z.ai/cn/docs/edit-history)、pi `AgentSession.navigateTree`（0.99.1）。
> 依赖阶段 8 会话分叉（`agent/fork/`）定下的「校验 → 独立/实时 manager 操作 → 落库」编排范式。
>
> 状态：**已完成**（`e35c16f`）。评审确认的取舍：同会话 branch + 重发；允许编辑活动分支上**任意**用户消息；
> 新增 `transcript_reset` 事件。

## 一、目标与范围

**目标**：用户可编辑已发送的用户消息并重新发送，从该消息之前继续推进，同一会话内模型 / 工作目录 / 模式 / 档位不变。被放弃的后续内容保留在会话文件里（旧分支），但不从对话区展示。

**做**：

- 活动分支上任意一条用户消息悬停出现「编辑」，行内改写后「发送」重发。
- 服务端用 pi 原生 `navigateTree` 把叶子移回该消息的父节点（首条则复位到根），随后以新文本重发。
- 通过新事件 `transcript_reset` 让所有打开的客户端重新取快照。

**明确不做（首批）**：

- 「连文件一起重置」：把这一轮改过的文件恢复原样。拆为可选子项，后续再评估（需要改动前快照，成本高）。
- 旧分支的版本切换 / 会话树浏览 UI：本期只在数据层保留，`buildContextEntries` 按叶子只展示新分支。
- 子智能体会话的编辑：子会话只读，服务端 400。

## 二、已锁定的决策

1. **机制**：同会话内 `navigateTree(entryId, { summarize: false })` + 重发。旧分支条目原样留在 JSONL，不删除、不总结。
2. **编辑范围**：活动分支（`manager.getBranch()`）上的任意 `user` 消息。不在活动分支上的（被放弃的旧分支）与活动分支上的非用户消息一律 400。
3. **忙碌判定**：除 `pool.isActive` 外，另用 `session.isIdle` 兜住压缩 / 分支总结 / 重试 / 排队，非空闲一律 `session_busy`（409）。
4. **同步**：新增事件 `transcript_reset`（活动分支已改变，客户端应重新取快照）。除发起方外的标签页据此保持一致。
5. **警示**：编辑非最后一条用户消息时，行内编辑区提示「其后内容将从对话中移除（仍保留在会话记录中）」，不做二次确认弹窗。
6. **不做 DB 变更**：不新增列、不迁移；`mode` / `cwd` / `forkedFromId` / 索引缓存都不动。
7. 编辑对所有模式（build / plan / ask）开放——这是用户动作，不是工具调用。
8. **决策点串行**：空闲判定 → 校验编辑点 → `navigateTree` → 发 `transcript_reset` → `startRun` 整段放在会话锁内，
   避免并发编辑各自通过空闲检查后重复改写活动分支；`startRun` 不占用锁，串行化的是决策点而非整轮生成。

## 三、语义与 pi 接缝

| 能力 | API | 用途 |
| --- | --- | --- |
| 把叶子移回目标消息父节点 | `AgentSession.navigateTree(entryId, { summarize: false })` | 核心：等价于 `branch(parent)` + 重建模型上下文，重建模型上下文由 pi 内部完成 |
| 目标为根消息 | 同上（内部 `resetLeaf()`） | 编辑首条用户消息 |
| 读活动分支 | `manager.getBranch()` | 校验编辑点在活动分支上 |
| 当前叶子路径 | `manager.getLeafId()` / `buildContextEntries()` | 消息列表按新叶子展示 |

要点：

- `navigateTree` 只移内存叶子、不写盘；紧接着的 `session.prompt()` 会把新用户消息追加为新分支的子节点（pi 在首条用户消息时就落盘），从而把新分支固化到文件。
- 若重发在追加用户消息前就失败（如鉴权失败），本次分支仅存在于内存；会话继续使用新分支，池回收后按文件回退。属已知边界（见第九节）。
- `navigateTree` 只恢复活动工具，**不**改会话模型 / 档位；`buildSessionOptions` 用的覆盖值仍在 DB，行为一致。
- 首条用户消息分支到根会得到第二个 root（pi 容忍多 root，`getTree()` 会返回它们；`buildContextEntries` 按叶子取路径）。接受该 pi 行为。

## 四、契约（packages/contracts）

- `messages/input.ts`：新增 `messageEditInputSchema`（`sessionId` / `entryId` / `text`）与
  `MessageEditInput` / `MessageEditRequest`。
  `entryId` 是消息 DTO 的 `id`（即 pi 条目 id），服务端对着活动分支校验。
- `messages/output.ts`：复用 `PromptAdmittedResponse`（`{ sessionId, admitted }`），不新增响应类型。
- `events.ts`：`EVENT_NAMES` 追加 `"transcript_reset"`（注释说明「活动分支已改变，客户端重新取快照」）。
- 错误码复用 `notFound` / `invalidRequest` / `sessionBusy`，不新增。

## 五、server 改动

- **新文件 `server/src/agent/edit/index.ts`**：纯函数
  `resolveEditableUserEntry(branch, entryId)`：不在活动分支 → 400；非 user 消息 → 400；否则返回条目。
- **`server/src/core/run.ts`**：新增 `admitEdit`，依次校验会话存在 / 非子会话 / 未归档 / 不在跑 →
  `pool.ensure` → `session.isIdle` → 校验编辑点 → `navigateTree` → 发 `transcript_reset` → 复用 `startRun` 重发。
- **`server/src/routes/messages/index.ts`**：新增 `POST /edit`，返回 `PromptAdmittedResponse`。
- **无 DB / schema 变更**。

## 六、前端改动

- `lib/api.ts`：`messages.edit`。
- `lib/types.ts`：补 `MessageEditRequest` 出口。
- `hooks/use-session-stream.ts`：订阅回调处理 `transcript_reset`，命中当前会话时重新取快照。
- `hooks/use-edit-message.ts`（新）：调接口 + 失败走对话区错误条；成功后由事件统一刷新。
- `hooks/use-chat.ts`：装配并暴露 `edit`。
- `components/message-item.tsx`：用户消息悬停铅笔 + 行内 textarea（发送 / 取消）；非最后一条显示移除提示。
- `components/message-list.tsx` / `chat-panel.tsx` / `App.tsx`：接线；子会话或生成中隐藏铅笔。
- i18n：`编辑` / `编辑并重新发送` / 移除提示 / `重发失败`，中英齐平。

## 七、测试方案

**L2 单元**（`server/src/agent/edit/__tests__/edit.test.ts`，真实 `SessionManager` 造分支）：

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| E-01 | 活动分支上的 user 消息 id | 放行，返回该条目 |
| E-02 | 活动分支上的 assistant 消息 id | `invalid_request` |
| E-03 | 不存在 / 不在活动分支（旧分支）的 id | `invalid_request` |

**L4 冒烟 / E2E（真实服务 curl）**：编辑首条 / 最后一条后重发、生成中 409、非法点 400、子会话 / 归档 / 不存在、编辑首条的多 root。

**L5 浏览器走查（`agent-browser`）**：铅笔入口、行内编辑、取消、发送后旧回复消失新回复出现、非最后一条提示、生成中无铅笔、刷新保持。

## 八、验收

- 编辑活动分支上任意用户消息并重发 → 该消息之后的旧内容从对话中消失，新回复接上；旧分支在 JSONL 中完好。
- 生成中 / 压缩中 / 有排队消息时返回 409；非法编辑点返回可读 400，不产生半成品。
- `transcript_reset` 送达后，其它已打开的同会话标签页刷新为新分支。
- 刷新后分叉状态保持；`pnpm check` 全绿。

## 九、风险与边界

- **旧分支无 UI 出口**：放弃的旧分支只留在 JSONL，本期不做版本切换 / 会话树浏览；编辑历史较久的消息对用户是「有损」的，靠行内提示预警。后续可评估复用 `agent/fork/` 把某旧分支导出为新会话。
- **分支固化时机**：重发若在追加用户消息前失败，内存分支与文件不一致，池回收后回退到旧分支。
- **多 root**：编辑首条用户消息会得到第二个 root，pi 容忍；不在本期处理。
- **文件不回滚**：模型已改的文件不会恢复，与「编辑只改对话」的语义一致。

## 十、落地顺序

1. 契约 → 2. `agent/edit/` 纯函数 + 单测 → 3. `core/run.ts` `admitEdit` + 路由 →
4. 前端 api / hook / 组件 / i18n → 5. `CHANGELOG.md` → 6. 更新母文档进度表 →
7. `pnpm check` + curl E2E + `agent-browser` 走查 → 停下等 review。

## 十一、复盘（落地时的偏差）

- **编辑范围放大**：母文档参考「只作用于最近一轮用户消息」，评审时改为**活动分支上任意用户消息**。
  代价是编辑较早消息会放弃其后一整段（对用户有损），因此 UI 对非最后一条给出移除提示；旧分支仍保留在
  会话文件里，后续可评估用 `agent/fork/` 导出为新会话。
- **同步机制新增事件**：跨连接同步改用新的 `transcript_reset` 事件，客户端据此重取快照；发起方不再自己 reload。
- **并发修复（review 后）**：`admitEdit` 最初只在锁内做 `ensure`，并发编辑会各自通过空闲检查、重复 `navigateTree`；
  改为把「空闲判定 → 校验编辑点 → `navigateTree` → 发事件 → `startRun`」整段收进会话锁，串行化决策点。
- **死代码清理（review 后）**：`useSessionStream` 一度返回未被消费的 `reload`，已移除（刷新统一走事件）。
- **不做**：文件不回滚（「连文件一起重置」留后续）；旧分支无版本切换 / 会话树 UI。

## 十二、验收记录

- `pnpm check` 全绿：212 单测（新增 4 条编辑点用例）+ 6 项约定校验。
- 真实服务 curl E2E（隔离 `APP_HOME` + 真实模型）：编辑首条 / 最后一条后重发，对话区只剩新消息 + 新回复；
  非法编辑点（不存在 / assistant / 非活动分支）400、不存在会话 404、生成中 409；会话文件里各分支用户消息全部保留。
- `agent-browser` 走查（提交前用最新构建重跑）：铅笔入口、行内编辑、非最后一条移除提示、发送后旧回复消失新回复出现、
  刷新后分支保持、生成中入口隐藏（`button[title=编辑并重新发送]` 数量 0 → 落定后恢复）。


