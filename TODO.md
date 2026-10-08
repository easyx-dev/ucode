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

## 需求 · 步级耗时统计的聚合与展示

**现象**：每步的耗时已经把三段拆开记进会话（`ucode.step` 条目，见 `server/src/harness/telemetry`），
但还没有聚合出口与展示——用量面板看不到「每轮步数 / 平均每步耗时 / 首 token 占比 / 工具耗时占比」，
于是「压缩阈值定多少、要不要降 thinking 档、并发子智能体要不要错峰」这些判断仍要手工扫会话文件。

**待办**：在 `harness/usage` 的派生里加上步级聚合，落到 `packages/contracts/src/stats/output.ts`
并在用量面板展示。**使用统计整体会另行重构**，这条可以并入那次重构，或等重构后按新结构补——
数据已经在按步落盘，缺的只是聚合与呈现。

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
