# 会话参数落档 · 模式与权限档位（起点 + 生效流）

> 状态：**未开始**（方案定稿，取舍已拍板，见第三节）。
> 上位文档：[`docs/session-entries.md`](../docs/session-entries.md)（条目登记表）、
> [`agent-tools-and-modes.md`](./agent-tools-and-modes.md)（模式与权限层）。
>
> 一句话目标：会话 JSONL 能自证「任意一轮跑在什么模式 / 权限档位下」，且这份记录不产生噪音、不依赖 `app.db`。

## 一、问题（现状核查）

### 1.1 现状链路

- 条目常量：`MODE_RECORD_CUSTOM_TYPE = "ucode.mode"`（`packages/contracts/src/constants.ts:177`），
  payload `{ mode?, permissionMode?, at }`（类型 `ModeRecord` 在 `:179-188`）。
- 唯一写点：`PATCH /api/v1/sessions/update` → `server/src/routes/sessions/index.ts:210-217`
  （`appendTranscriptPatch`，定义在 `:193`）。同路径上模型 / 档位走 pi 原生
  `model_change` / `thinking_level_change`（`:206-209`）。
- 运行时真值：`app.db` 的 `session.mode` / `permission_mode` 列；`pool.ensure` 读它决定工具集、
  提示词、记忆工具（`server/src/core/pool.ts:597,627` → `harness/session-config.ts:222-223,279`）。
- 下发与展示：`server/src/core/serialize.ts:382-391` 白名单放行成 `modeChange`，
  前端 `packages/ui/src/lib/chat-nodes.ts:430-433` 渲染细线。
- **这个条目目前是只读展示品**：权限引擎（`approvalMode` 来自 `overrideOf(record).permissionMode`）
  与装配（工具集、提示词、plan 待决策判定）读的都是 `app.db`，没有一条运行路径读 `ucode.mode`。

### 1.2 两个缺口

**缺口一：写的是「用户点击」，不是「本轮生效」。**

- 连切 N 次不发消息 → 文件里 N 条条目、界面 N 条细线，其中 N-1 条从未影响任何一轮；
  同时每次切换都会 `pool.dispose` + `transcript_reset`（`sessions/index.ts:294-297` / `:299-301`），
  即「没生效的切换」也要付重建实例与全量重拉转录的代价。
- 切换后发出的第一条消息，其模式只能靠「上一次切换点」回推；会话从没切过就没有任何记录。

**缺口二：会话文件里没有起点，运行事实不可自证。**

- pi 的 `SessionHeader` 只有 `{ type, version, id, timestamp, cwd, parentSession }`
  （`pi-coding-agent/dist/core/session-manager.d.ts:5-16`），没有 mode。
- 草稿期切到 plan 再发第一条消息 → 该会话文件的全部条目里没有一处写「这个会话跑在 plan」。
- 对照：模型有痕迹（assistant 消息自带 `message.model` / `provider`，`serialize.ts:201-202`），
  思考档位有 `thinking_level_change` 条目，唯独模式两头都缺。

### 1.3 后果

- 删 `app.db` 重建（AGENTS 允许直接删本地数据）或把 JSONL 拷到别的实例 → 模式一律回落
  `DEFAULT_SESSION_MODE = "build"`（`server/src/db/session-repository.ts:169`），文件里无从恢复。
- 事后审计「这一轮为什么能写文件」没有逐轮可查的证据链。
- `docs/session-entries.md` 开头「JSONL 是会话的事实源」这句话，在模式上不成立。

## 二、已锁定的决策

### 2.1 写点从「切换动作」挪到「轮开始」，并承担起点职责

写点放在 `pool.startRun`（`server/src/core/pool.ts:295-313`）与 `pool.startInjectedRun`（`:315-341`），
`beginRun` 成功之后、`session.prompt` / `sendCustomMessage` 之前追加一条 `ucode.mode`
（复用现有类型与 payload，不新增条目类型）。抽一个私有 `recordRunSettings(sessionId, session)` 承载。

**写点不能落 `beginRun`（:825-830）**：它是 `startRun` / `startInjectedRun` / `startCompaction` 共用的，
压缩不是一轮，不该产生设置点。

依据（方案成立的关键）：pi 的新会话文件**只在含 user 或 assistant 消息时才创建**，
而首次创建是把内存 `fileEntries` 全量一次写出
（`pi-coding-agent/dist/core/session-manager.js:791-814`，`_hasConversation` + `_persist`）。
因此在 `SessionManager.create()`（`pool.ts:608`）之后、首条消息之前追加的设置点会留在内存，
随首条消息一起落盘，**位置在 user message 之前**，天然就是起点；且「只新建没聊天」的会话
依旧不产生文件，现有草稿语义不变。

配套语义：

- **差分写**：池内**实例**上记「已写入值」，与 `record.mode` / `record.permissionMode` 相同即跳过。
  状态不能挂在条目对象上——模式变更必然 `dispose`，条目会跟着消失；照
  `harness/telemetry/index.ts:30-31` 的 `turn` 计数（按实例生命周期计数、重装即重置）落。
  注意它的作用面只有「同一实例内连续多轮」：**「切了但没跑就零写入」是 2.4 删掉 PATCH 写点实现的**，
  与差分写是两件事，原稿把两个收益都挂在差分写上。
- **重装即重置**：dispose / 空闲回收后标记丢失，下一轮再写一条。这不是冗余，而是「本实例的生效值」
  ——重建会话实例才让模式生效（`sessions/index.ts:294-297`）。
- **排队不算新一轮**：steer / followUp 走 `run.ts:178-181`，不经 `startRun`，同一轮内不会重复写。
- **存量文件自愈**：任何被继续使用的老会话，下一轮就补上起点；按「不做历史兼容」的约定不回填脚本。
- **子会话**：`harness/subagents/spawn.ts:175` 的 `child.prompt(task)` 不经 `pool.startRun`，子会话文件会
  缺起点。但子会话实例本身就是 `pool.ensure` 建的（`spawn.ts:255` → `pool.ts:527`），所以补写点落在
  `ensure` 的**新建分支**即可，不必给 spawn 加钩子（原稿「子会话不经过 pool」的前提写错了）。
- **fork**：`createBranchedSession` 保留 root→leaf 路径，设置点在路径上就带过去；不在也无妨，新文件第一轮自动补。
- 写完后按 `fromEntryId` 发一次 `transcript_reset`（与 `routes/messages/index.ts:126-129` 的 ignore-plan 同款）。

### 2.2 `app.db` 降级为缓存：打开会话时用文件校准

`pool.ensure` 打开已有文件时（`pool.ts:605-608`，`find` 在 :589、`SessionManager.open` 在 :607）取分支
最后一条设置点，与 `session.mode` / `permission_mode` 不一致就回写（`SessionRepository.set`，
`session-repository.ts:328-352`，`COALESCE` 语义在 :334-340，不动 `updated_at`）。这才让
「JSONL 权威、DB 缓存」在模式上真正成立，并解决删库 / 拷贝文件两种丢模式场景。

**时序坑（原稿没写，不处理就等于没校准）**：`ensure` 在 :597 就把 `record.mode` 取成局部量 `mode`、
`:607` 才打开文件；`permissionMode` 则经 `overrideOf(input.record)`（`session-repository.ts:201`）进
`approvalMode`（`session-config.ts:166`）。回写库之后必须**重新取一份 record 再走装配**，
否则本轮仍按旧值建实例，校准要等下一轮才生效。

边界：

- 文件里的 slug 可能是已被删除的自定义角色 → 校准时先用 `hasPrimaryMode` 校验
  （`server/src/harness/agents/capability.ts:45`），未知 slug 不回写；装配侧本就有兜底（`:39-42`）。
- **子会话行不参与校准**：子会话的 `mode` 继承父（`spawn.ts:244`），拿它的文件回写会把父的模式
  洗成子会话的起点。
- **与 `docs/database.md` 正面冲突**：该文件 :51-52 把 `mode` / `permission_mode` 归入「应用自己写、
  会话文件里没有对应表示」的会话状态组，:74-76 更写明「不再从文件回读任何元数据……删库重建后
  mode / permission_mode 会丢失——这是有意的取舍」。采纳本方案就得同步改这两处，并在那里写明
  「文件权威、DB 是缓存、回写失败只记日志、下一轮再校准」。

### 2.3 投影带出：让每轮自带口径

`transcriptStates`（`serialize.ts:165-180`）已在沿**完整分支**推进 `thinking_level_change` /
`model_change`，加一个 `MODE_RECORD_CUSTOM_TYPE` 分支把 mode / permissionMode 塞进 `TranscriptState`，
再由 `messageToDTO`（`serialize.ts:188-206`，现在只回填 `provider` / `thinkingLevel`（:201-202））带到
`MessageDTO`。

- 入参是 `manager.getBranch()`（`routes/messages/index.ts:44`），**压缩不影响**——压缩只裁剪展示用的
  `buildContextEntries()`。
- 与 `provider` / `thinkingLevel` 同一套机制，不是新概念；`serialize.ts` 的 `modeRecordOf` 已是现成解析器。
- 不新增落盘内容，纯投影收益：UI 可在轮末 / 消息上标注当时模式（**本轮不做**，见第三节：
  细线已经是同一信息的呈现，两种表达重复；这层投影先只作为数据能力备着）。
- 契约改动：`packages/contracts/src/messages/output.ts`（`modeChange` 附近）+ `docs/api-reference.md`。

### 2.4 `PATCH /sessions/update` 不再写会话文件

删掉 `sessions/index.ts:210-217`。切换仍要 `pool.dispose`（换工具集与提示词必须重建实例）、
仍要 pause goal（`:237-243`），但不再往文件里追加条目。

## 三、已拍板：切换动作不再在转录里留痕

原取舍（写点挪到轮开始后，那条「模式已切换」细线的归属）定为 **A**：

| 选项 | 含义 | 代价 |
| --- | --- | --- |
| **A（已选）** 写点只在轮开始 | 细线出现在「本轮开始」处，语义是「接下来这轮的参数」；切换本身只在选择器上即时反馈 | 点一下切模式、转录里立刻多一行提示的行为消失 |
| B 额外保留操作日志 | 切换时另写一条不含运行语义的条目 / 前端事件 | 噪音与「未生效也记一笔」随选择器一起回来 |

判断依据：转录记录的是**会话里发生的事**，不是设置面板的操作日志。若产品确实要操作日志，
那是另一层表示（前端本地或独立事件），不应塞回会话文件。

**语义随之变化，这是原稿漏掉的一整块界面工作**：

- `ucode.mode` 条目从此只有一个含义——「这一轮跑在什么参数下」，不再是操作日志；
- 细线文案要跟着改：`packages/ui/src/lib/mode.ts:35-51` 的 `modeChangeText` 现在吐的是
  「模式已切换 / 权限档位已切换 / 模式与权限档位已切换」，对应
  `packages/i18n/src/locales/ui/en.ts:292-294` 三套 key；按新语义应是「本轮：编码 · 自动」这一族，
  三套旧 key 随之删除（zh-CN 不登记，靠回退与插值）；
- 不改行类型、不加新形态：仍是 `chat-nodes.ts:430-433` 的 `kind: "mode"` 细线，只换文案取法。
- 由此还多出一个已知噪音：服务重启 / 空闲回收后的新一轮会再写一条起点，界面会在「本轮开始」处
  再出现一条同义细线。这是「起点」语义的必然结果（而不是 bug），原稿把它当成差分写能消掉的东西。

## 四、改动清单（按依赖顺序）

| 顺序 | 文件 | 改动 |
| --- | --- | --- |
| 1 | `packages/contracts/src/messages/output.ts` | `MessageDTO` 加 `mode?` / `permissionMode?`（契约先行，紧挨 `modeChange`） |
| 2 | `server/src/core/serialize.ts` | `TranscriptState` 加两字段；`transcriptStates`（:165-180）认 `ucode.mode`；`messageToDTO`（:188-206）带出 |
| 3 | `server/src/core/pool.ts` | 新增 `recordRunSettings`（差分状态挂实例）；`startRun` / `startInjectedRun` 调用；`ensure` 新建分支补子会话起点；打开已有文件时校准（含「重新取 record」的时序） |
| 4 | `server/src/routes/sessions/index.ts` | 删 `ucode.mode` 写点（:210-217）与随之而来的 `transcript_reset` 分支；`dispose`（:294-297）保留 |
| 5 | `packages/ui/src/lib/mode.ts` + `packages/i18n/src/locales/ui/en.ts` | 细线文案按「本轮参数」重写，删三套旧 key（第三节） |
| 6 | `docs/session-entries.md` | `ucode.mode` 行的**写入点改成只写轮起点**（`core/pool.ts`），payload 说明改成「本轮生效值」——原稿写的「轮起点 + 变更」与 2.4 自相矛盾 |
| 7 | `docs/database.md` | :51-52 / :74-76 两处口径改写（见 2.2 末条） |
| 8 | `docs/api-reference.md` | DTO 新字段（`pnpm api:docs`） |
| 9 | `CHANGELOG.md` | 「变更」（对外接口加字段 + 条目写点语义变化） |
| 10 | `server/src/core/__tests__/` | 用例见第五节 |

## 五、验证

单测（放 `server/src/core/__tests__/records.test.ts` 同级风格，同级 `__tests__` 才被执行）：

- 同值不重复写（第二轮无新增条目）。
- 切了不发消息不写（PATCH 后文件条目数不变）。
- 第一轮必写起点，且落在首条 user 消息之前。
- 重装实例后第一轮重写一条。
- 子会话首轮带起点（`ensure` 新建分支）。
- DB 校准：文件为 plan、DB 为 build → 打开后 DB 变 plan；文件为已删除的自定义 slug → 不回写；
  **校准后的本轮装配用的是文件里的值**（守时序那个坑）。

真机：`pnpm build && pnpm start`，切三次模式不发消息后
`grep -c '"customType":"ucode.mode"' "$APP_HOME"/harness/sessions/<id>.jsonl` 不变；
发一轮后文件开头多一条；列表行与转录细线的模式一致；细线文案是「本轮参数」而非「已切换」。
删 `$APP_HOME/app/app.db` 重启后打开那个会话，模式从文件恢复。最后 `pnpm check`。

## 六、被否方案

- **只在首次落盘补一条起点**：压缩后 UI 侧失效（只展示压缩点之后），每轮仍需回推，DB 丢了只救起点，
  PATCH 期间的噪音一条不少。
- **在 `ucode.step` 里加 mode**：能答每轮，但文件里始终没有「当前参数」的权威快照，
  fork / 拷贝 / 删库都不成立，等于用长会话的体积换「拿不准所以多抄一遍」；而且「为什么切成这样」仍需设置点流。
  若将来有防篡改 / 合规审计要求，可作为第二道保险另议。
- **写进 pi 的 session header**：`SessionHeader` 与 `NewSessionOptions` 都没有扩展点，为此 fork 上游不值当。
  若 pi 日后暴露 header 扩展或通用 settings 条目，这条记录应并进去。

## 七、明确不做

- 不加「设置快照」新条目类型，不为历史文件写回填脚本。
- 不改 pi 的条目树与 `docs/session-entries.md` 的登记机制。
- 不顺手改模型 / 档位的写点：`model_change` / `thinking_level_change` 是 pi 原生语义，
  且模型在每条 assistant 消息里自带（`serialize.ts:200`），缺起点的影响面小得多。
