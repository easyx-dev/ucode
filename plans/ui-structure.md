# packages/ui 结构重排：域内聚与跨域上提

> 来源：`packages/ui` 目录结构、组件组织形式与组件架构的整体重排。状态：**已落地**（结构搬迁 + 逻辑归位，
> 组件内部实现与视觉零改动）。判据与约束写进 [`docs/components.md`](../docs/components.md)，本文件记录落位、决策与后续。

## 一、搬之前的四个问题

| 问题 | 具体表现 |
| --- | --- |
| `lib/` 是四类东西的混合体 | 62 个文件里混着跨域通用方法（`path` / `time` / `storage`）、单消费者私有逻辑（`git-patch` 只给 `workbench/diff-viewer`、`mcp-form` 只给设置的一个弹层）、模块级状态与设备 IO（`dialog` 队列、`notice` 通知桥、`sound` 音频单例、`shiki` 高亮器单例、`appearance` 的 localStorage + DOM）、以及 React 代码（`error.ts` 的 `useErrorText` 是个 hook，与「无 React 依赖的纯函数」这条定义直接冲突） |
| `business/` 平铺 72 个 `tsx` | 一级没有组织轴：域入口平铺在外（`composer.tsx`）、骨架与可复用渲染件与弹层基座混在同一层；`settings/`(26) / `workbench/`(21) 是正确样例但规则没写下来 |
| `hooks/` 里两种东西混着 | 43 个文件里约 20 个只有一个调用点（`use-mermaid-svg` / `use-table-wrap` / `use-zoom-viewport` / `use-plugins` …），与真正跨域的 SDK store 绑定同层 |
| 出现反向依赖 | `workbench/markdown-preview → ../message-response`（工作台反向依赖消息流的渲染件）、`composer/attachment-chip → ../attachment-token`、`settings/settings-plugins → provider/workbench` |

## 二、目标结构与落位判据

```
packages/ui/src/
  base/               24 个：无业务语义的原语（19 个 shadcn 产物 + 分段控件 / 工具条图标按钮 / 细化线 / 复制动作 / 品牌标识）
  utils/              14 个跨域通用方法 + 6 个用例（原 lib/ 里真正跨域的那批）
  hooks/              10 个跨域复用 / 通用绑定 + store/ 13 个 SDK store 订阅与派生
  provider/           6 个：注入 client 的三个 Provider + 外观偏好事实源（appearance / themes / fonts）
  business/           12 个域，156 个组件；一级全部是目录
    chat/             28 组件 + 11 逻辑，域内再分四块：根上是对话区骨架，`message/` 消息流（投影 + 行渲染）、
                      `tool/` 工具与子智能体的呈现、`activity/` 运行态浮层与子会话小窗、`decision/` 决策面
    composer/         13 组件 + 15 逻辑，域内再分 `editor/`（编辑器内部）、`picker/`（四个选择器）、
                      `document/`（文档与标记编解码）、`project/`（项目取值与选择器）
    session/          10 组件 + 2 逻辑（侧栏、会话列表、项目分组）
    goal/             3 组件 + 2 逻辑（目标栏、目标轮次线、命令解析与文案）
    markdown/         7 组件 + 10 逻辑（入口 + diff）+ `code/` `mermaid/` `table/` 三块
    attachment/       3 组件 + 1 逻辑
    dialog/           5 组件 + 3 逻辑（函数式弹层队列、宿主、全屏与缩放预览基建）
    notify/           6 逻辑（桌面通知、声音、会话提醒判定与开关）
    shell/            4 组件（登录页、主题 Provider、错误提示、命令面板）
    settings/         26 组件 + 8 逻辑，域内再分 `pages/`（单个分页与它的 hook）、`models/`、`plugins/`、`mcp/`
    workbench/        21 组件 + 12 逻辑 + git/ 与 file/ 两个子域
    usage/            8 组件
  presets/workspace/  预设：1 个入口 + 6 个按关注点拆的 hook（外壳几何 / 工作台 / 会话动作 / 目标与计划 / 内置命令 / 快捷键）
  types.ts            契约与 SDK 类型的包内出口（原 lib/types.ts）
```

判据（新增模块时用，写进了 `docs/components.md`）：只被一个域用 → 该域目录内；被 ≥2 个域用且无 React → `utils/`；
被 ≥2 个域用且是 React 绑定 → `hooks/`；被 ≥2 个域用且是纯展示组件 → `base/`。

规模变化：`business/` 平铺 72 → **0**；`lib/` 62 → **`utils/` 14 + `src/types.ts` 1**；`hooks/` 43 → **23**
（其中 13 个是 store 薄绑定）；超过十来个文件、职责已分两层的域内都已再开子目录；唯一越过文件 600 行强制阈值的
`presets/workspace-layout.tsx`（902 行）拆成了 444 行入口 + 6 个 hook。

## 三、几个需要判断的落位与理由

- **`decision/` 归 `chat/` 而不是独立域**：`chat-nodes` 同时被消息流与权限/问答组件引用，而 `chat-panel` 又要渲染
  决策面板——独立成顶层域就是 `chat ↔ interaction` 的域级环。
- **`divider-line` / `toolbar-icon-button` / `copy-action` / `segmented-control` / `brand-logo` 进 `base/`**：
  它们横跨 chat / goal / markdown / settings / workbench / usage / session / shell，留在任何域内都会形成环。
  `base/` 因此从「shadcn 产物」扩义为「无业务语义的原语」，豁免文件级注释的范围相应收窄到 CLI 生成的那批。
- **「会话条目 → 视图模型」这层投影全部归 `chat/`**：`chat-item`（行 key 与正文文本）、`goal-turns`（按目标轮次切分）、
  `session-activity`（活动面板视图模型）与活动浮层的两个组件一度分散在 `utils/` / `goal/` / `session/` 三处，
  它们被三个域引用的原因只是这个投影层被拆到了三个目录，不是真通用；收回 `chat/` 后，`goal/` 与 `session/`
  的展示件只从 `chat/` 借类型（数据由 `chat-panel` 以 props 传入），`goal/` 也成了一个不依赖任何业务域的叶子域。
  设计文档里活动面板本就落在「对话区右上角」，归 `chat/activity/` 与此一致。
- **`chat/` 域内再分组**：收拢投影后该域到 28 个组件 + 11 个逻辑，已过「域内文件超十来个」这条线，
  于是按职责分四块：`message/`（条目投影 + 行渲染 + 目录条）、`tool/`（工具与子智能体的呈现）、
  `activity/`（运行态浮层 + 子会话小窗）、`decision/`（权限 / 问答 / 计划），根上只留对话区骨架。
  子目录之间可以互引（`decision/` 用 `tool/` 的工具标题、`chat/` 的行向 `message/` 的投影取数据），
  它们同属一个域，不适用跨域方向表。
- **hooks 判据贯彻**：`use-mcp-servers` / `use-plugins` 与 `use-usage` / `use-sessions` 同形（都是
  `useStore(client.x)` + 载入 / 动作转发），因此不再留 `settings/`，回到 `hooks/store/`；
  反之 `use-in-view`（视口观察）、`use-token-number`（读设计 token 的像素值）与域无关，
  虽然当前只有一个消费者也回暖 `hooks/`。判据写进 `docs/components.md`。
- **`composer/` 与 `settings/` 域内分组**：两者分别到 28 / 36 个文件，都已过线。`composer/` 分
  `editor/`（Tiptap 内部）、`picker/`（四个选择器与它们的文案）、`document/`（文档 ↔ 载荷、草稿、标记）、
  `project/`（项目取值与选择器）；`settings/` 分 `pages/`（单个分页与它的 hook）、`models/`、`plugins/`、`mcp/`，
  根上留面板骨架与「整个面板共用」的草稿 / 保存逻辑。`markdown/`（17）分出 `code/` `mermaid/` `table/`
  （各自带引擎、hook 与弹层）；`workbench/git/`（17）暂不再分，粒度与 `chat/message/` 相当。
- **`appearance` / `themes` / `fonts` 进 `provider/`**：外观偏好只有一处真相，它的读写与应用都属于
  `AppearanceProvider` 这一件事，放 `utils/` 会掩盖这层归属。
- **`lib/types.ts` 提到 `src/types.ts`**：它是包的类型门面（40 处引用），不是「逻辑」。
- **`business/dialog/queue.ts` 由 `lib/dialog.ts` 改名**：目录名已是 `dialog`，文件名不再重复语义；
  函数式弹层的队列与宿主、预览基建同处一个域。
- **`workbench/git-marks.tsx` 改名 `git-change-marks.tsx`**：`lib/git-marks.ts`（标记取值）与它会同落
  `workbench/git/`，同名冲突；组件按职责取名，导出（`GitStatusMark` / `GitCounts`）不变。
- **`message-chips` / `composer-document` 留在 `composer/` 而不是 `utils/`**：`composer-document` 依赖前者，
  消息渲染也依赖前者；放 `composer/` 才能让 `chat → composer` 保持单向（`chat-panel` 本来就要 `Composer`）。
  这也是「有域语义的模块不进 utils」的样板。
- **`notify` 单独成域**：桌面通知桥、提示音、会话提醒判定与三个开关 hook 是同一条链路，
  放进 `shell/` 会与「应用外壳级组件」混在一起。
- **`workbench/` 再分 `git/` 与 `file/`**：收拢私有逻辑与 hook 后该域会到 35 个文件，第二层职责已经很明显。
- **预设不再是一个文件**：`presets/workspace-layout.tsx` 原本同时装着外壳几何（侧栏收起与持久化、两个抽屉、
  桌面断点、窗口控件中线实测）、工作台动作面与文档标签、会话动作与草稿、目标与计划命令、内置命令分派、
  全局快捷键。它是本次唯一越过 600 行强制阈值的文件，按上述六个关注点抽成同目录 hook，入口只留 props、
  骨架与串联；hook 在入口里的调用顺序与原来的 effect 顺序一致（只换了一处：压缩提示与工作台项目记忆，
  二者互不依赖）。拆完用脚本比对了拆前/拆后 JSX 的属性名集合（66 个，无增无减）。

## 四、批次与验证

| 批次 | 范围 |
| --- | --- |
| 一 · 地基 | 建 `utils/`（14 个跨域方法 + 6 个用例）、`src/types.ts`；外观三件进 `provider/`；拆 `lib/error.ts` 为 `utils/error-text.ts` + `hooks/use-error-text.ts`；`hooks/store/` 成型；`exports` 的 `./lib/*` → `./utils/*` |
| 二 · 渲染域 | `dialog/`（含 `queue.ts` 改名）、`attachment/`、`markdown/`、`goal/`；`divider-line` / `toolbar-icon-button` / `copy-action` 上提 `base/` |
| 三 · 对话与输入 | `chat/`（含 `decision/`）、`composer/`、`session/` |
| 四 · 外围域 | `notify/`、`shell/`、`settings/`、`workbench/`（含 `git/`、`file/`、`segmented-control` 与 `brand-logo` 上提）、`usage/`；`lib/` 清空 |
| 五 · 接线与文档 | `components.json` 的 aliases、外壳引用（`business/shell/*`、`utils/*`、`hooks/use-error-text`）、`scripts/verify` 的两处硬编码路径、代码注释与规范文档的路径提法、本文件 |
| 六 · 审查修正 | 把「会话条目 → 视图模型」投影（`chat-item`、`goal-turns`、`session-activity`）与活动浮层的两个组件从 `utils/`、`goal/`、`session/` 收回 `chat/`（含 `chat/activity/`）；`chat/` 域内再分 `message/`（投影 + 行渲染）、`tool/`（工具与子智能体呈现）、`activity/`、`decision/`，根上只留骨架 |
| 七 · 审查修正 | 贯彻 hooks 判据：`use-mcp-servers` / `use-plugins`（store 薄绑定）进 `hooks/store/`，`use-in-view` / `use-token-number`（无域语义）回暖 `hooks/`；`composer/` 与 `settings/` 域内分组，`markdown/` 分出 `code/` `mermaid/` `table/` |
| 八 · 预设拆分 | `presets/workspace-layout.tsx` 902 行（本次唯一超过 600 行强制阈值的文件）拆为 —— `workspace-layout.tsx`（444 行：props、三栏骨架、抽屉、串联）+ `use-workspace-chrome` / `use-workbench-controller` / `use-session-actions` / `use-goal-and-plan` / `use-builtin-commands` / `use-workspace-shortcuts`；`exports` 的 `./presets/workspace` 目标改为 `src/presets/workspace/workspace-layout.tsx`（对外子路径不变）。拆分后用脚本比对拆前/拆后 JSX 属性名集合（66 个，无增无减），并在 dev 环境走查快捷键、工作台、设置、用量面板与会话切换 |

- **预设不再是一个文件**：见上，`presets/workspace/` 拆为 1 入口 + 6 hook（`exports` 的 `./presets/workspace`
  指向 `src/presets/workspace/workspace-layout.tsx`，对外子路径不变）。

搬运用 `git mv` 保留历史，导入路径按「旧路径 → 新路径」的映射表由脚本重算（不做 sed 盲替）。
每批以 `pnpm -F @ucode/ui typecheck` 与 `pnpm -F @ucode/ui test` 收敛，中途态保持可编译；
全量 `pnpm check`、`pnpm build` 与一次浏览器走查放在最后统一跑。

## 五、后续（本轮不做）

- **域依赖方向校验**：方向现在只写在 `docs/components.md` 的表里，靠人守。搬迁时用一份一次性脚本按「模块 → 域」
  逐条比过相对导入（含环检测），结论：包内无运行时环，唯一一个环是 `composer/editor → extensions →
  use-composer-attachments → editor`，其中回边是 `import type`，构建后被抹掉。
  这类体检值得照 server 侧 `layers` 的做法落成 `scripts/verify` 的 `ui-layers` 校验（`utils` 与 `base`
  不得引组件、`workbench` 不得引 `chat`、`hooks` 不得引业务域之类），本轮未动 `scripts/verify`。
- **两处已知的跨域取舍**：`composer/project-row` 用 `workbench/use-workbench-data` 的 git 状态（已写进方向表）；
  `hooks/store/use-chat` 取 `composer/composer-payload` 的类型、`provider/workbench` 取 `workbench/workbench-docs`
  的类型，都是 `import type`。要彻底去掉这三条边就得让草稿载荷类型与工作台文档类型再下沉一层，
  收益不大，先按「类型边不计入方向」处理。
- **超长文件拆分（剩下的）**：`chat-nodes`(566) / `chat-panel`(446) / `composer`(434) / `command-palette`(383) /
  `message-list`(372) 已过 400 行预警阈值；其中 `chat-nodes` 是单一算法（索引 → 配对 → 聚合 → 特殊行），
  `chat-panel` / `composer` 是「一个组件里写了整套状态机」，可以照预设的办法抽 hook。
- **公开面收口（已落地）**：删掉无人使用的根入口 `.`（原 `src/index.ts`，`types` 改指 `src/types.ts`），
  新增 `pnpm verify` 的 ui-exports 校验（exports 目标存在 / 通配后缀与目录一致 / 外壳引用可解析），
  边界与备选见 [`plans/ui-exports.md`](./ui-exports.md)。`./business/*` 仍保留通配（文档里的「应用层可自拼
  业务组件」是刻意保留的能力），但它对外的是**组件**，域内 `.ts` 不在公开面内。
