# 压缩分隔行：默认收起，以及刷新后误滚到压缩点

> 依赖：`plans/ui-convergence.md`（消息区的行类型与虚拟列表）、
> [`docs/session-entries.md`](../docs/session-entries.md)（`ucode.compaction` 条目）。
>
> 状态：**未开始**（方案定稿，待实施）。

## 一、背景与目标

两条现象，性质不同：

1. **「对话已压缩」默认收起**——这是期望行为（已拍板）：不看有没有摘要，压缩行一律默认收起，
   要看得手动点开。现状相反：有摘要就默认展开（`business/compaction-divider.tsx:22` 传
   `defaultOpen={hasSummary}`），所以这条是**改行为**。
2. **每次刷新页面，滚动条自动滚到「对话已压缩」的位置**——这是 bug。根因是「新出现一条压缩行」的
   判定在 hydrate 时被误触发（见第四节），与第 1 条无关，但两条要一起改：收起态决定了它滚过去之后
   用户看到的就是一行贴在视口顶部的细线。

## 二、范围界定

| 场景 | 现状 | 本次 |
| --- | --- | --- |
| 压缩行默认折叠态 | 有摘要展开、无摘要收起 | **一律收起** |
| 摘要在收起态可见吗 | 展开体条件渲染 | 仍可点开（`children` 继续传，保证可点） |
| 刷新页面后的视口 | 误停在压缩行 | 停在最新一行（与同一次挂载里的 `scrollToLatest` 一致） |
| 本轮真的新压了一次 | 滚到「第一条」压缩行（`align: "start"`） | 滚到**最后一条**（最新那次压缩的位置） |
| 虚拟列表回收后重挂载 | 回到 `defaultOpen` | 同样回到收起（已知代价，见第八节） |
| 老会话（只有 `summary`、没有 `ucode.compaction` 记录） | 分隔行落在 index 0，刷新后滚到列表顶部 | 同一守卫一起覆盖（首屏不滚） |
| 数据层：会话里有多条 `ucode.compaction` 记录 | 旧的记录也下发展示成折叠行 | **不动**（见决策 5） |

## 三、已锁定的决策

1. **一律默认收起**：`compaction-divider.tsx:28` 的 `defaultOpen` 固定为 `false`，不再看 `hasSummary`。
2. **摘要仍必须可展开**：`divider-line.tsx:27` 在 `children === undefined` 时判为不可点，所以
   `children`（摘要体）照旧传，只是初值收起——否则摘要就再也看不到了。
3. **「新压了一次就滚过去」这个行为保留**：压缩完历史一换，用户正看着底部的内容会平白变短，
   把视口落到压缩点是原本正确的设计（`message-list.tsx:183-195` 的注释写的就是这个意图）。
   本次只修「首次拿到历史时被误判成刚压过」。
4. **多条压缩行时取最后一条**：`compactionKeyOf` 与取下标的实现改成从后往前找。
   现有实现取的是**第一条**（`findIndex`），多条时会把视口对到早就发生的那次压缩上。
5. **不改数据层去重**：`serialize.ts:432-444` 只保最新一条 `compaction`（pi 原生）条目，
   `ucode.compaction` 记录条目只要落在保留区间里就仍会下发，于是同一次压缩可能对应两条记录。
   这是数据层的既有形态，本轮不动——用户已确认「一律收起」是期望行为，多出来的那条视觉上一致。
6. **不引入持久化**：折叠态不落 `localStorage`（仓库里唯一的 localStorage 用于侧栏与工作台），
   也不跨虚拟列表的卸载保留（行出了视口就按初值重来，属既有行为）。

## 四、成因与修改

### 4.1 一律收起

`business/compaction-divider.tsx` 把 `defaultOpen={hasSummary}` 改成不传（`divider-line.tsx:26` 的
`useState(defaultOpen)` 会拿到 `undefined` → 收起）；`children` 与 `aria-expanded` 的逻辑一律不动。
`compaction-divider.tsx` 文件头注释（现在写着「摘要默认展开……想只留一行细线时可以收起」）要按新行为改写，
否则它立刻变成假话。

### 4.2 刷新后误滚（根因链，证据逐条）

1. hydrate 是异步的：SDK 的引擎初值 `items: []`（`packages/sdk/src/stores/messages/engine.ts:73`），
   `activate` 在 effect 里发请求（`hooks/use-session-stream.ts:14-16`），快照回来才 `patch({ items })`
   （`stores/messages/index.ts:191-195`）。挂载那一帧 `rows` 必然是空的。
2. `message-list.tsx:165-172` 的 `useLayoutEffect`（首次挂载与切会话都跑）本意是「记住这一刻的分隔行」，
   但它跑在 rows 为空时，于是 `lastCompactionKeyRef.current = compactionKeyOf([]) === null`。
3. 快照到达 → key 由 `null` 变为 `entry-x` → `:188` 的判定认为「新出现一条压缩分隔行」→
   `setFollowingBoth(false)` 并 `:194` `scrollToIndex(index, { align: "start" })`。
4. 同一 commit 内 `:198-207` 因 `followingRef.current === false` 直接返回，不再把视口拉回底部。
5. 虚拟列表的 offset reconcile 会保持落点若干帧，所以不是闪一下而是稳定停住——与「每次刷新都停在
   压缩行」完全吻合。

**修法**：把「首次拿到历史」与「历史就绪后又新增压缩行」区分开。加一个「已经见过行」的 ref：

- `message-list.tsx:165-172` 那条 effect 里把它重置为 `false`（切会话与首次挂载都重置）；
- `:183-195` 那条 effect 开头：若还没见过行，这一次只更新基线、直接返回，不滚。
  真正的压缩完成时 rows 一定非空，所以「空 → 非空」只可能是首屏 hydrate 或切会话，判据安全。

**同时**把 `compactionKeyOf`（`message-list.tsx:37-38`）与取压缩行下标的 `findIndex`（`:191`）改成
从后往前找：多条压缩行时应落到最新那次。

## 五、改动清单

| 顺序 | 文件 | 改动 |
| --- | --- | --- |
| 1 | `packages/ui/src/lib/chat-rows.ts` | 从 `message-list.tsx` 抽出 `compactionKeyOf(rows)` 与「最后一条压缩行的下标」两个纯函数并导出（该文件已是行类型与行装配的落点） |
| 2 | `packages/ui/src/lib/__tests__/chat-rows.test.ts` | 补这两个函数的用例（见第六节） |
| 3 | `packages/ui/src/business/message-list.tsx` | 删本地实现改 import；加「已经见过行」的 ref 与首屏守卫；`findIndex` 换从后往前 |
| 4 | `packages/ui/src/business/compaction-divider.tsx` | `defaultOpen` 不再传；文件头注释按新行为改写 |
| 5 | `DESIGN.md` | 「消息区」里压缩分隔行的描述：默认收起、点开看摘要 |

不涉及契约、服务端、SDK、会话条目：本次没有落盘内容的变化。

## 六、测试

新增纯函数用例（`node:test` + `node:assert/strict`，与被测模块同级的 `__tests__/`）：

- `compactionKeyOf`：无压缩行返回 `null`；单条返回该行标识；多条时返回**最后一条**的标识；
  标识在行内容变化（同一压缩点）时保持稳定。
- 取下标：多条时取最后一条；`rows` 为空返回 `-1`。

首屏守卫与滚动落点没有既有测试（`__tests__` 下 grep `scroll|virtual|following` 零命中），
按第七节在真实浏览器走查，不新增组件测试框架。

## 七、验收

- `pnpm check` 一轮一次。
- `agent-browser` 走查（`pnpm dev` 开 `:5173`；一串动作合成一次调用）：
  1. 打开一个已压缩的会话 → 视口停在**最新一行**，不跳到压缩行；压缩行是收起态；
  2. 点压缩行 → 展开看到摘要，再点收起；
  3. 刷新页面（同一会话）→ 仍然停在最新一行；
  4. 切到另一个已压缩的会话、再切回 → 同上，不停在压缩点；
  5. 触发一次真实压缩（长会话里发消息顶到阈值），压缩完成后视口落到**最新**那条压缩行的顶部，
     随后流式生成的回答仍在视野内（跟随被关掉是这条行为的既有代价，与现状一致）；
  6. 老数据形态（只有 `summary`、没有 `ucode.compaction` 记录）的会话 → 分隔行在列表顶部附近时，
     刷新不停在它上面。

## 八、已知边界与代价

- **收起态不跨虚拟列表回收保留**：行滚出视口被卸载后回来又是收起。这是决策 6 的直接结果，
  与「一律收起」的取向一致（要看就点开）。
- **多出的一条记录仍在**：数据层不去重（决策 5），所以一次压缩可能对应两条折叠行；用户确认过这是
  可接受的视觉结果。若以后要收拾，落点是 `serialize.ts:432-444` 那一段。
- **`align: "start"` 的落点**：滚动到压缩行时它的顶部对齐视口顶部，所以画面上方露不出被压缩掉的那段
  历史——这是原设计意图，不改。

## 九、暂不做 / 已否决

- **折在会话里持久化**（记住用户上次是展开还是收起）：不做。多一份状态、多一处 `localStorage`，
  而点一下的代价极小。
- **把压缩行做成 `<details>`**：不做。现在是受控的 `useState` + 按钮（`divider-line.tsx:40-52` 带
  `aria-expanded`），换成原生元素会丢掉统一的细线样式。
- **数据层去重**（同一次压缩只留一条记录）：不做，见决策 5。
- **改「压缩完滚到压缩点」这个行为本身**：不做，见决策 3。
