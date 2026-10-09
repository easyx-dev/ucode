# TODO

只列**未完成**的条目，做完即删。历史看 [`CHANGELOG.md`](./CHANGELOG.md)，逐项落位看 [`plans/`](./plans/)。

---

## 待定 · 内置供应商的「拉取模型列表」入口

设置页的「拉取模型列表」只出现在自定义供应商上：内置供应商的模型清单来自 pi 内置目录（只读、随升级更新），
要拉取就得先把结果落成 `models` 覆盖内置清单——属于另一件事，等确认要不要做。

---

## 暂缓（等明确指令再启动）

- **插件机制**：方案见 [`plans/plugins.md`](./plans/plugins.md)。
- **中继服务**：方案见 [`plans/relay.md`](./plans/relay.md)，前置的服务化与鉴权已落地。
- **内置 TODO 工具 / wiki**：暂无实现计划。

---

## 需求 · 技能命中与调用的记录

**现象**：模型自动命中技能时（照系统提示里的 `<available_skills>` 去读 `SKILL.md`）会话里没有任何痕迹，
只有一次普通的 `read` 调用；显式 `/skill:name` 也只有用户消息上的 chip。于是「用过哪些技能、谁选的、
什么时候用的」既看不到也统计不了。

**方案**：新增 `ucode.skill` 条目（`hit` / `invoke` 两个来源），命中标记挂在对应的 `read` 调用卡片上，
不单独占行。见 [`plans/skill-usage-record.md`](./plans/skill-usage-record.md)。

---

## 需求 · 步级耗时统计的聚合与展示

**现象**：每步的耗时已经把三段拆开记进会话（`ucode.step` 条目，见 `server/src/harness/telemetry`），
但还没有聚合出口与展示——用量面板看不到「每轮步数 / 平均每步耗时 / 首 token 占比 / 工具耗时占比」，
于是「压缩阈值定多少、要不要降 thinking 档、并发子智能体要不要错峰」这些判断仍要手工扫会话文件。

**待办**：在 `harness/usage` 的派生里加上步级聚合，落到 `packages/contracts/src/stats/output.ts`
并在用量面板展示。**使用统计整体会另行重构**，这条可以并入那次重构，或等重构后按新结构补——
数据已经在按步落盘，缺的只是聚合与呈现。

**方案**：见 [`plans/usage-stats-refactor.md`](./plans/usage-stats-refactor.md)——定稿的走向是**先重构再聚合**：
把 `UsageService` 的三职责（解析 / 聚合 / 运行期状态）拆开，`ucode.step` 接进解析层，并给步级记录补
`userTurn` / `provider` / `model` / `stopReason` 四个字段、修正 `ttftMs` 的口径；**缓存命中率**一并做
（数据早已具备，缺的只是派生与展示）。

---

## 需求 · 浏览器 / 桌面端操作能力改成插件

**现象**：曾内置过一个 `browser` 工具（`harness/browser`，基于 `playwright-core`，含浏览器与桌面端两个目标），
**现已整体撤掉**——能力面太窄（只有 open / click / fill / press / wait / eval / expect / screenshot），
真实界面验证里常用的悬停、下拉、勾选、滚动、上传、前进后退、元素清单都缺，继续加只会让「内置工具」越滚越大。
决定改为**以插件形式集成**：一次把「agent 操作浏览器」与「agent 操作桌面端」作为同一件事做进来。

**撤掉时删掉的东西**（重做时按需取回，别重复踩）：`harness/browser/*`、`playwright-core` 依赖、
`APP_BROWSER_PATH` / `APP_DESKTOP_PATH`、`browser` 的工具名与权限规则、提示词里的浏览器分节与 `<page>` 边界。
**保留**：桌面端 `resolveHomeDir` 的 `~` 展开修复（那是独立的现存 bug）。

**插件要覆盖的能力**（对照 `agent-browser` 0.31.1 的命令面梳理，按优先级）：

1. **动作**：现有 8 个 + `snapshot`（`page.ariaSnapshot()`，给角色 / 名称而不是易变的 `@eN` 引用）、
   结构化 `expect`（`{ selector, state: "visible"|"hidden"|"text"|"value"|"count"|"checked", value? }`，
   失败要说清「期望 vs 实际」）、`select`、`check` / `uncheck`、`hover`、`reload`、`scroll`、`upload`、
   `back` / `forward`；第二梯队 `type`（逐字符键入）、`screenshot` 的 `element` / `clip`。
   `drag` 必须先实测：我们的分栏是 pointer-events 实现（shadcn Resizable），`locator.dragTo` 未必生效。
   注意 `select` / `check` 的描述要写明 shadcn / Radix 的下拉与开关是 button + listbox / `role=switch`，
   对它们必须两次 click。
2. **桌面端同样是一等目标**（不是浏览器的替代品）：应用主进程会从 `service.json` 取 `serviceToken` 注入渲染层，
   驱动它等于**带真实凭证、动真实数据**；dev 场景的启动要点是用 `DESKTOP_RENDERER_URL` 指向已构建的渲染层
   （否则非打包启动只认 dev server）。Playwright 的 `_electron` 是实验性 API 且与 Electron 版本绑定。
3. **安全边界必须原样继承**（这几条是踩过点定的，重做时别丢）：只驱动系统已装的浏览器（不下载）、
   **不持久化 profile**（每次跑在临时 context 里，继承不到也写不进用户的登录态）、
   调试端口只连回环且不引入任何放宽安全的开关、动作与 `bash` 同权限档且只读模式不给、
   页面内容按外部不可信内容包裹（`<page>` 边界已在撤掉时一并移除，重做时补回）。
   与 `agent-browser` 的关键差别就在这里：它支持 `--profile Default` 复用真实登录态、`--auto-connect`
   挂上正在跑的 Chrome——能力更强，但那是把用户的全部登录态交给 agent，需另行拍板。

**待确认**：插件形态（是否走现有扩展机制 / 独立包）、是否给「需要登录态的流程」开口子（以及怎么隔离）、
动作集按上面到哪一档为止。

**本轮不做**：插件机制本身还在「暂缓」清单里，且这道题的第一句就是形态未拍板——留在 TODO 里等指令。
附一条调研结论：`plans/plugins.md` 的插件跑在 server 进程内，**物理上驱动不了 Electron**，所以就算插件
机制先落地，浏览器 / 桌面端那套「服务端挂起 + 客户端执行」的桥仍要单独做（见 `plans/builtin-browser.md`）。

---

## 需求 · 会话参数（模式 / 权限档位）落档

**现象**：`ucode.mode` 只在 `PATCH /sessions/update` 时写一条——切了没跑也记一笔，真跑起来却查不到起点。
结果是会话 JSONL 无法自证「任意一轮跑在什么模式 / 权限档位」，`app.db` 一删模式就回落 `build`。

**待办**：写点挪到「轮开始」（起点 + 同实例内多轮才生效的差分写，pi 的首条消息落盘会自动带上它），
投影里带出每轮模式，打开会话时用文件校准 `app.db`。
**方案**：[`plans/session-params-entries.md`](./plans/session-params-entries.md)；其中「切换动作是否还在转录里留痕」
**已拍板选项 A**（写点只在轮开始，细线变成「本轮参数」的语义，切换本身不再留痕；连带要改 `ui/lib/mode.ts`
与 en 目录的三套旧 key）。

---

## 需求 · 对话区输入区与空态重构

**现象**：输入卡是「白卡 + 卡内目录行」，工作目录只是一行灰字、分支完全看不到（只活在工作台的改动标签里）；
空态是文字水印 + 一句问候，建议 chips 夹在输入卡上方且无图标；模式与权限档位只有名字，说明要悬停才看得到；
「添加附件」只有粘贴与拖拽两个入口，没有显式的菜单入口。

**方案**：见 [`plans/composer-layout.md`](./plans/composer-layout.md)——输入卡改「项目 / 分支条 + 白卡」双层、
空态改居中 hero、新增「+」菜单与「标题 + 副标题」的模式 / 权限弹层、草稿态可预设权限档位。
**本轮不做**：消息区（参考图的文件卡与「N 个文件已更改 / 撤销」需要按轮 git 快照）、远程连接 / 工作流 /
插件市场（没有实现，入口也不出现）、已有会话的换项目与 checkout 分支。

---

## 需求 · 消息里的图片 / 附件改成文字 token

**现象**：图片与附件现在都以视觉形态出现——编辑器里是 16px 缩略图、用户消息里是 `max-h-40` 缩略图与
兜底媒体行的 `max-h-96` 大图，正文排版被图片撑坏，编辑时缩小了也一样丑。

**方案**：正文里一律渲染成文字 token（`<图片 1>` / `<report.pdf>`，与发送时写进正文的 `图片 N` 标记同形），
图片点开原图弹层、附件点击下载；序号按文档顺序现算（编辑器与消息回放共用一份纯函数）。
见 [`plans/attachment-token.md`](./plans/attachment-token.md)。

---

## BUG · 刷新后自动滚动到「对话已压缩」

**现象**：每次刷新页面，滚动条都会自动滚动到「对话已压缩」的位置——hydrate 时会话还没有任何行，
「新出现一条压缩分隔行」的守卫被误触发，视口被对到压缩点且跟随被关掉。

**已拍板**：压缩行**一律默认收起**（不看有没有摘要）是期望行为，现状「有摘要就展开」要改。

**方案**：见 [`plans/compaction-row.md`](./plans/compaction-row.md)。

---

## 需求 · 模型请求重试（5 次）并在对话中展示

**现象**：模型请求失败后界面「什么都不发生」。实际是 pi 的回合级重试（默认 3 次、2s 起步指数退避）
一直在跑，但 `auto_retry_start` / `auto_retry_end` 事件被 ucode 丢弃、失败也不进 DTO，过程与结果都不可见。

**待办**：上限改 5（只改回合级），每次重试落 `ucode.retry` 条目并下发展示为细线。

**方案**：见 [`plans/model-retry.md`](./plans/model-retry.md)。

