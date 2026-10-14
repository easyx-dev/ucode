# 原语层盘点：补齐跨域原语与 `title` → `Tooltip` 收敛

> 来源：对 `packages/ui/src/base/`（25 个原语）与 `business/**` 重复形态的一次盘点——哪些该抽成原语、
> 哪些原语本身要改、以及 `title` 的收敛口径。
> 状态：**已落地**（批次 0–6）。`IconButton` / `Empty` / `InputSearch` 已进 `base/`，
> `base/toolbar-icon-button` 与 `base/divider-line` 已消失，`title` 收敛为「只作截断兜底」。
> 除特别注明外，路径相对 `packages/ui/src/`；行号取自盘点当时的代码。

## 一、现状

25 个原语，分三类：

| 类别 | 原语 |
| --- | --- |
| shadcn CLI 产物（19） | `button` `badge` `avatar` `input` `textarea` `label` `select` `dropdown-menu` `context-menu` `dialog` `sheet` `tooltip` `switch` `collapsible` `scroll-area` `separator` `skeleton` `sonner` `resizable` |
| 自研原语（6） | `spinner` `toolbar-icon-button` `segmented-control` `copy-action` `divider-line` `brand-logo` |

引用文件数（`grep -rl "base/<name>"`）：`button` 51、`spinner` 20、`input` 18、`dialog` 14、`tooltip` 11、
`badge` 10、`segmented-control` 10、`select` 9、`label` 8、`dropdown-menu` 8、`switch` 6、`divider-line` 5、
`collapsible` / `context-menu` / `toolbar-icon-button` 各 4、`brand-logo` / `copy-action` 各 3、`resizable` 2、
其余（`avatar` `scroll-area` `separator` `sheet` `skeleton` `sonner` `textarea`）各 1。

真实问题两条：**跨域重复的形态没有原语**（空态、图标按钮 + Tooltip、搜索行），以及**少数原语带缺陷或落位不准**
（焦点环缺失、`title` 与 Tooltip 双提示、禁用态改底色、菜单跨原语分叉）。

## 二、已锁定决策

1. **按钮族只有一个文件**：`base/button.tsx` 导出 `Button` / `IconButton` / `buttonVariants`；
   **不建** `TooltipIconButton`，Tooltip 由 `Button` 的 `tooltip` prop 内聚。
2. **空态叫 `Empty`**：单名单词，与 `Spinner` / `Badge` 一致，也与 shadcn 上游的 `empty` 对齐。
3. **Input 家族同处 `base/input.tsx`**：`Input` + `InputSearch`（将来 `InputNumber` 同处），共用一份底座类。
4. **`Card` / `CardActions` 不建**：那三处不是卡片，统一外壳会引入元素类型开关，收益不抵复杂度（见 §七）。
5. **`title` 只用于截断兜底**：讲操作 / 讲含义一律 Tooltip（口径见 §四）。

## 三、逐项方案

### 3.1 `base/button.tsx`：加 `tooltip`、加 `IconButton`

```tsx
type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** 悬停说明：传了就内聚 Tooltip；不参与可访问名（纯图标按钮的可访问名用 IconButton 的 label） */
    tooltip?: string;
    asChild?: boolean;
  };

/** 纯图标按钮预设：label 同时是 aria-label 与悬停说明 */
export function IconButton({ children, label, pressed, size = "icon-sm", ...props }) {}
```

- `tooltip` 传了就不再写原生 `title`（原 `toolbar-icon-button.tsx:36` 的写法删掉）。
- **不处理 `asChild` 组合**：`Button` 的 `asChild`（`button.tsx:45-51`）全仓零调用，按注释说明「与 tooltip 不叠加」即可。
- **`disabled` 态不弹 tooltip**：原生 `disabled` 的 button 不派发 pointer / focus 事件，`button.tsx:10` 还有
  `disabled:pointer-events-none`，所以 `<Button disabled tooltip="…">` 静默失效。本次不包 span（那会给 51 处调用
  多一层 DOM、工具条的 `flex gap-*` 间距都要复核），在组件注释里写明；已知受影响 1 处（`workbench/file/file-content.tsx:71`）。
- `IconButton` 吸收 `base/toolbar-icon-button.tsx`（该文件删除）：`label` 必填、`pressed` 传了才写 `aria-pressed`、
  `size` 直接用 `buttonVariants` 现成档位（`icon-xs`=size-6、`icon-sm`=size-7），不新造档位。
- 命名不叫 `ToolbarIconButton`：工作台、表格操作区、消息头、全屏弹层都在用，「工具条」名不副实。
- 破坏面为零：`toolbar-icon-button` 只有 4 处引用（`business/dialog/fullscreen-dialog.tsx:12`、
  `business/dialog/zoomable-preview.tsx:17`、`business/markdown/table/markdown-table.tsx:20`、
  `business/attachment/attachment-image.tsx:11`），两个外壳只 import 过 `@ucode/ui/base/button`（`apps/web/src/App.tsx:10`）。

调用点迁移：

| 位置 | 现状 | 迁移后 |
| --- | --- | --- |
| `business/workbench/workbench-activity-bar.tsx:44-78` | 裸 `Button` + 手写 `title` / `aria-label` / `Tooltip` | `IconButton` |
| `business/workbench/file/file-tree.tsx:198-209` | 同上（`size="icon" className="size-6"`） | `IconButton`（`icon-xs`） |
| `business/workbench/file/file-content.tsx:64-76` | 同上（`title` 与 `TooltipContent` 两份文案） | `IconButton` |
| `business/workbench/git/review-tree.tsx:63-88` | 同上（两处） | `IconButton` |
| `business/workbench/git/diff-controls.tsx:40-52` | 同上（手写 `aria-pressed` + 按下态类） | `IconButton`（`pressed`） |
| `business/workbench/git/git-file-diff.tsx:66-81` | 同上 | `IconButton` |
| `business/chat/chat-header.tsx:231/264/281`、`business/chat/copy-transcript-action.tsx:38`、`business/markdown/table/markdown-table.tsx:36-52`（域内自抽的 `TableAction`） | 三件套各写一遍 | `IconButton`，`TableAction` 删除 |
| `business/dialog/fullscreen-dialog.tsx:49`、`business/dialog/zoomable-preview.tsx:28/41`、`business/attachment/attachment-image.tsx:40` | 只有原生 `title` 悬停提示 | `IconButton`（第一次获得真 tooltip） |

`toolbar-icon-button.tsx` 的 `title={label}` 删掉后，原本「包了 Tooltip 的 13 处」不再双提示（见 §四）。

### 3.2 `base/input.tsx`：家族底座 + `InputSearch`

- 底座：`input.tsx:10` 与 `textarea.tsx:10` 的公共类现在手抄两遍（只差 `py-1.5` / `leading-relaxed`），
  收成一份，`Textarea` 复用；`size` 只收 `sm` / `md` 两档。
- `InputSearch`：`relative` 容器 + 放大镜 + `Input`；props 走原生透传（`value` / `onChange` / `onKeyDown` /
  `autoFocus` 都靠 `...props`）。
- 5 处调用里 **3 处不是 `Input`**，是裸 `<input>`（无描边、透明底，边框在容器上）：
  `business/shell/command-palette.tsx:299-311`（h-11）、`business/composer/project/project-picker.tsx:89-99`（h-11 pl-9）、
  `business/composer/picker/model-picker.tsx:103-110`（h-7 pl-7）；靠调用点 `className`（`border-0 bg-transparent`）
  压掉描边，**不加样式开关 prop**。
- 另外两处是 `Input` + 绝对定位图标：`business/workbench/file/file-tree.tsx:190-198`（h-6 pl-7）、
  `business/settings/models/provider-add-dialog.tsx:47-56`（pl-8）。
- 落地时：模型选择器的搜索行在另一处改动里被去掉，实际替换 4 处。放大镜固定在 `left-2 size-icon-sm`；
  紧凑档要连窄屏那档一起覆盖（`text-xs md:text-xs`——`Input` 在窄屏固定 16px 是为了不让 iOS 聚焦时缩放页面）。

### 3.3 `base/empty.tsx`（新增，唯一净增文件）

```tsx
type EmptyProps = {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
};
```

虚线框不进 props（需要框的调用点传 `className`）。替换对象：

- 三套域内实现：`business/workbench/panel-empty.tsx`（8 处调用）、`business/settings/settings-page.tsx:95`（3 处）、
  `business/usage/usage-section.tsx:28`（5 处）；
- 6 处内联复制（同一串 `rounded-xl border border-dashed px-4 py-6 text-center text-sm text-foreground-subtle`）：
  `business/settings/models/settings-models.tsx:42`、`provider-models.tsx:68`、`provider-model-fetch.tsx:144`、
  `business/settings/plugins/plugin-market-section.tsx:101`、`business/settings/pages/settings-remote-access.tsx:149`、
  `business/settings/models/provider-add-dialog.tsx:75`；
- 两个外壳：`apps/desktop/src/renderer/components/service-unavailable.tsx`（顺手补上缺失的下一步动作）、
  `apps/web/src/App.tsx:139`。

### 3.4 复制反馈：`base/copy-action.tsx` 内聚 `useCopyFeedback` + `copy-action` 改造

`COPIED_HINT_MS = 1500` + 定时器复位被抄了 4 份：`base/copy-action.tsx:12-25`、
`business/chat/copy-transcript-action.tsx:14-31`、`business/markdown/table/markdown-table.tsx:28-66`、
`business/settings/pages/settings-remote-access.tsx:78`。React 绑定 + 跨 4 域 → 按落位判据进 `hooks/`，
返回 `{ copied, copy }`。

`base/copy-action.tsx` 随之改成纯展示：渲染换成 `IconButton`（补上现在缺的 `focus-visible` 焦点环、
去掉手写的 `<button>`——`copy-action.tsx:28-40` 是原语里第三套手写图标按钮），剪贴板 IO 与状态机移出。

> 落地时：hook 没单独进 `hooks/`，而是内聚在 `base/copy-action.tsx` 并从这里导出——它就是这个原语的内部状态，
> 另 3 处只是要借这套反馈；放 `hooks/` 会让 `base/` 反向依赖状态层（分层表里没有那条边）。

### 3.5 `divider-line` 下沉 `business/chat/message/`

文件注释自陈是「对话里的细线」，5 个调用点全在 `business/chat`（compaction / injected / retry）与
`business/goal`（divider / turn-line），语义属 chat。顺带修三处：补 `className` 透传（`:13-22` 现在没有）、
补 `focus-visible` 焦点环（`:48` 只有 `outline-none`）、删 `:49` 的 `title={open ? t("收起") : t("展开")}`
（保留 `aria-expanded`）。`goal/` 两处改为从 `chat/` 借用。

### 3.6 清账（低风险，可与上面并行）

| 项 | 位置 |
| --- | --- |
| `"use client"` 残留（`components.json` 是 `rsc: false`） | `label.tsx:1`、`separator.tsx:1`、`scroll-area.tsx:1`、`tooltip.tsx:1` |
| 空表达式 | `select.tsx:77` 的 `position === "popper" && ""` |
| 永不生效的选择器（`SelectItem` 没有 `variant`） | `select.tsx:107` |
| 未定义的空类名 | `sonner.tsx:30` 的 `cn-toast` |
| 类型色未映射（`toast.error` 与普通提示同色） | `sonner.tsx:20-27`（只映射了 `--normal-*`；sonner 的类型底色要 `richColors` 才生效） |
| 禁用态用悬停底 | `input.tsx:10`、`textarea.tsx:10` 的 `disabled:bg-state-hover` |
| 硬编码英文文案（绕过 i18n 校验） | `dialog.tsx:63`、`:98` 的 `Close` |
| 缺 `aria-hidden` | `skeleton.tsx:6` |
| `className` 透传位置（会被后面的 `dark:hidden` 压掉） | `brand-logo.tsx:18/23/39/44` |
| props 类型内联、文件级注释不在第一行 | `spinner.tsx:5`、`toolbar-icon-button.tsx:15`、`copy-action.tsx:17` |

### 3.7 立项时另记的两件（不在本次范围，供后续挑）

- `business/session/local-user-row.tsx`：注释自陈「设置导航与侧栏页脚共用」，被 `business/settings/settings-nav.tsx:19`
  值导入；纯展示、无会话语义，命中「≥2 域 + 纯展示 → base」。它是盘点中唯一一处「因共享而摆错位置」的组件。
- `apps/web/src/components/brand-head.tsx` 与 `apps/desktop/src/renderer/components/brand-head.tsx` 逐字相同（6 行）。

## 四、`title` 收敛口径

`grep 'title={' packages/ui/src` 有 100+ 处，只有三类，别混：

| 类别 | 例子 | 处理 |
| --- | --- | --- |
| 可点元素的悬停说明 | `toolbar-icon-button.tsx:36`、`copy-action.tsx:34`、`session-list-item.tsx:120/129`、`chat-header.tsx:184/199/221/238/270/286`、`composer.tsx:417/421`、`question-request.tsx:153/247/257/266`、`workbench-activity-bar.tsx:56/73`（约 25 处） | 换成 `tooltip`；**有可见文字的按钮直接删，不要加 tooltip** |
| 截断文本兜底 | `session-list-item.tsx:85`、`git-file-diff.tsx:50`、`goal-bar.tsx:105`、`tool-call.tsx:89/122/144/150`、`message-footer.tsx:68` | 保留（`docs/components.md` 要求 `truncate` + `title` 兜底；挂在 `<span>` 上没有 Tooltip 触发元素） |
| 组件自己的 `title` prop | `PanelEmpty` / `UsageSection` / `SheetContent` / `DecisionHeader` / 预览弹层 | 不动（是 props 名，不是 DOM 属性） |

已经两样都传的（`file-content.tsx:70`、`diff-controls.tsx:47`）只是删 `title`。

**为什么要收敛**：`TooltipProvider` 全局挂在 `presets/workspace/workspace-layout.tsx:239`，`tooltip.tsx:9` 给了
`delayDuration = 0`——Radix tooltip 立刻弹，而原生 `title` 约 1 秒后再弹一个浏览器灰框（Radix 不摘 `title`），
同一颗按钮先后弹两次。这条按机制推断，走查时确认。

## 五、批次

| 批次 | 范围 |
| --- | --- |
| 0 · 规范 | `docs/components.md`：① 「组合优先」补例外——包裹类关注点（Tooltip 等）可用 prop 内聚，内容组合仍走 children；② 纯图标按钮一律 `IconButton`（`label` 单源）；③ `title` 只用于截断兜底 |
| 1 · 按钮族 | `base/button.tsx`（`tooltip` + `IconButton`）、删 `base/toolbar-icon-button.tsx`、§3.1 的调用点迁移、§四 的 `title` 收敛 |
| 2 · Input 族 | `base/input.tsx`（底座 + `InputSearch`）、`base/textarea.tsx` 复用底座、4 处替换（模型选择器的搜索行已在另一处改动里去掉） |
| 3 · 空态 | `base/empty.tsx` + §3.3 的替换（含两个外壳） |
| 4 · 复制 | `base/copy-action.tsx`（内聚反馈 hook 并导出）、另 3 处收敛 |
| 5 · 落位 | `divider-line` → `business/chat/message/` |
| 6 · 清账 | §3.6 |

## 六、验证

- 改完统一跑一次 `pnpm check`（不中途反复全量跑）；每批收尾可先跑 `pnpm -F @ucode/ui typecheck` + `test`。
- **合并成一次**浏览器走查：
  - workbench 悬停一个图标按钮停 1.5 秒，确认不再先后弹两次；
  - 键盘 Tab：`copy-action`、`divider-line` 这两处新补的焦点环可见（本次修的两个 a11y 缺陷）；
  - `InputSearch`（命令面板 / 项目选择 / 供应商目录）与文件树搜索；模型选择器的那处已随搜索行一起去掉；
  - `Empty` 在明暗两主题下；`disabled` 的「重新读取文件」按钮确认不弹 tooltip（预期行为）。
- `pnpm build` 会覆写生产产物，走查按 `AGENTS.md`「验证命令」的边界来（`pnpm dev` + `APP_HOME=.tmp/.ucode`）。

## 七、不做 / 已否决

| 方案 | 否决理由 |
| --- | --- |
| `TooltipIconButton` 组件 | 与 `Button` 的 `tooltip` prop 重复；组合层要它只是为了「`label` 写两遍」，让 `Button` 内聚更彻底（13 处 × 4 行 → 1 个 prop） |
| `CardActions` + `Card` | 三个调用点的容器都不是卡片：`attachment/attachment-image.tsx` 用 `span.group/image relative inline-block`（文件注释说明必须是 `span`，图常落在 `<p>` 里）、`markdown/code/code-block.tsx` 是 `group/code relative`、`markdown/mermaid/mermaid-block.tsx` 是 `md-mermaid`（样式来自 `styles/markdown.css:113`）。真正的卡片表面 `ring-1 ring-border-strong` 在业务里有 17 处，但圆角 / 阴影 / 底色各不同，抽 `Card` 必然带开关。这一项只有 3 处，收益最低 |
| 列表行容器上提 `base` | `session-list-item.tsx:80` / `settings-nav.tsx:52` / `git-change-tree.tsx:72` / `command-palette.tsx:355` / `provider-list.tsx:40` 的选中态取值、高度（h-7/8/9）、圆角（md/lg/xl）全不同，抽出来必须传样式开关，与 `docs/components.md` 的 props 约定冲突 |
| 卡片外框上提 `base` | chat / composer / settings 三处阴影与底色各不同，同上 |
| `AttachmentToken` 上提 | 有域语义（附件类别、同类序号、`t("图片{{index}}")`），位置本来就对 |
| `SettingsRow` / `Field` / `MetricCard` / `StepCard` 上提 | 域内重复（settings、usage），域内合并即可 |
| 列表分组小标题、状态点 | 只有一行 class、`px` 随容器变，抽出来收益接近零 |
| `dialog` 的 `showCloseButton` 改造 | shadcn 惯例，记为明确例外，不改调用点 |
| 删 `collapsible`（零样式纯 re-export） | 被 4 处使用，不是死代码；留着当门面 |
| 删 `separator` / `scroll-area` | `separator` 是「薄且被 4 处手写 `h-px bg-border` 绕过」，`scroll-area` 只 1 处使用且与 20+ 处原生 `overflow-y-auto` 滚动条外观不同——两者属**待观察**，本次只记不动 |

## 八、待定（需拍板，不阻塞批次 1–6）

1. **`pressed` 的底色**：`toolbar-icon-button.tsx:33` 用 `bg-muted text-foreground`（`git/diff-controls.tsx:46` 的
   换行开关同款），而 `DESIGN.md:248-249` 的按下 / 选中口径是 `bg-state-active` / `bg-state-selected`。
   倾向：在 `DESIGN.md` 里补一个「工具条按下态」token 并保留 `bg-muted`，而不是机械替换——两者的视觉意图不同。
   本次迁移**保持现状 `bg-muted`**，只标注。
2. **`segmented-control.tsx:49` 的选中白底**（`bg-card shadow-raised`）与 `DESIGN.md:249` 的 selected 口径冲突，
   同上：倾向在 `DESIGN.md` 记为例外。本次不动。
3. **`Empty` 的虚线框是否统一**（三套实现的字号 / 内边距 / `h-full` 不一致）：本次维持各处现状，虚线框走 `className`。
