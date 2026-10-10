# 工作台面板的布局形态（活动栏 + 侧栏 + 编辑器区）

> 状态：**已实现**。数据与接口见 [`workbench-panel.md`](./workbench-panel.md)，视觉取值见
> `DESIGN.md`「分栏」与「面板内部」。本次只改**版式与信息架构**，`fs` / `git` 契约只多了一条
> `git/contents`（展开未变更区域时取两侧原文）。

## 形态

```
桌面：
┌────┬──────────────────┬────────────────────────────────────┐
│活动│ 侧栏（180–360）    │ 编辑器区                            │
│栏  │ ┌──────────────┐ │ ┌ a.ts ×┬ b.ts ×┬ 3f2a1c ×┐        │
│ 40 │ │项目文件 /     │ │ （预览 / diff / 提交详情）           │
│ ▣  │ │ 源代码管理     │ │                                     │
│ ⑂  │ └──────────────┘ │                                     │
│    │                  │                                     │
│ ▯  │                  │                                     │
└────┴──────────────────┴────────────────────────────────────┘

窄屏（<768，抽屉铺满屏宽）：侧栏与编辑器互斥
┌────┬────────────────────────────┐
│活动│ 侧栏 或 编辑器（点文件即切换） │
└────┴────────────────────────────┘
```

| 区域 | 内容 |
| --- | --- |
| 活动栏 | 项目文件（文件树）、源代码管理（改动 / 历史）；点当前视图的图标即收起侧栏；最下是收起面板 |
| 侧栏 | 随视图切换；文件树带 git 装饰，代码管理是「改动（变更树）/ 历史（提交列表）」两个视图 |
| 编辑器区 | 打开的文档各占一个标签：文件预览、某个变更的 diff、提交详情、提交里某个文件的 diff；没有标签时给空态 |

## 为什么这样

**活动栏 + 常驻侧栏，是「看什么」与「看哪一份」的分工。** 上一版把「改动 / 文件」做成面板顶部的两个
药丸标签，左侧树列随标签切换——那是「左挑右看」的两栏工具，标签表达的是**对象类型**。改成活动栏切视图
之后，标签表达的是**打开了哪些文档**，与 VSCode 一致：切换到 git 变更看 diff 时，项目树还留在原处，
不必关掉一个再开一个。

**编辑器区按文档出标签，而不是每个视图各带一个内容区。** 需求里要的是「多标签 + 双栏 diff + 全部展开
收起」，这三件事都要求内容区是独立的文档视图：同一文件可以同时开着「预览」和「改动 diff」（id 由内容
与来源构成，互不覆盖），关掉标签即返回，不必再为每个视图造一套返回按钮。标签上限 8 个，超出丢最早的
那个（激活项不动）。

**diff 的渲染交给 `@git-diff-view/react`。** Split / Unified、行号、hunk 折叠、未变更区域的逐步展开
（点一下铺开 40 行，可继续）、字符级高亮都是它的能力，因此自己那套铺行与折叠区间
（`lib/diff-blocks.ts`、`lib/diff-rows.ts`）全部删掉。代价是它自带一套 `--diff-*` 与 `.hljs-*` 配色，
必须在我们的样式里整组改写成语义 token（见 `styles/theme.css` 的 diff 视图一节），否则就多出一套颜色体系；
高亮改用项目现成的 shiki——官方适配层（`@git-diff-view/shiki`）把主题写死成 github light / dark，
所以自写一个适配器（`lib/shiki-diff.ts`）复用同一个引擎与 `--code-*` 主题。另一个坑：它的 `hunks` 参数不是行数组
——每个元素都会被当成一整段 diff 交给解析器，所以要整段拼好（`lib/git-patch.ts`）。

**对比结构仍由服务端解析。** 客户端不重跑比对（大文件会退化成「全删 + 全增」），hunk 结构照旧来自
`git/diff`，只是还原成 patch 文本交给库；两侧原文来自 `git/contents`，供它算未变更区域——拿不到
（二进制 / 超 1MB / 还在加载）时那些区域就展不开，其余照常显示。

**窄屏不三列并排。** 抽屉铺满屏宽后也只有 390px 上下，活动栏 40 + 侧栏 180 之后编辑器只剩不到 170px。
所以窄屏退化成单列互斥：点文件即切到编辑器，编辑器标签条最左给返回箭头。

**git 分成两组而不是四组。** 未跟踪与冲突都还没进 index，归进未暂存即可；四段列表反而让人来回找。
两者靠字母区分（未跟踪 `U`、冲突 `!`），服务端 `/git/status` 的四个桶保持原样——分组是展示层的事。

**文件树接 git 装饰，也是「少切视图」的思路。** 改动过的文件在树里就变色并带字母徽标，目录按「其下最重
的那个标记」着色（`lib/git-marks.ts` 的严重度表），不必为了确认某个文件有没有改过而切到代码管理视图。

## 文件级改动

| 文件 | 职责 |
| --- | --- |
| `provider/workbench.tsx` | `view` / `selectView` / `sidebarVisible` / `toggleSidebar` / `docs` / `activeDocId` / `selectDoc` / `closeDoc` / `openFile` / `openChange` / `openCommit` / `openCommitFile` / `collapse` / `cwd` |
| `lib/workbench-docs.ts`（新） | 文档类型、id 规则与打开 / 切换 / 关闭的纯逻辑（上限 8）；`hooks/use-workbench-docs.ts`（新）持状态 |
| `lib/git-marks.ts`（新） | 来源桶 → 标记（未跟踪单列）、字母与色调表、目录严重度、文件树装饰映射 |
| `lib/git-groups.ts`（新） | 四个桶 → 「已暂存 / 未暂存」两组 |
| `lib/git-patch.ts`（新） | 结构化 hunk → 一整段 patch 文本（库的 `hunks` 入参形态） |
| `business/workbench/workbench-activity-bar.tsx`（新） | 活动栏两个视图 + 收起面板 |
| `business/workbench/workbench-sidebar.tsx`（新） | 按视图渲染文件树 / 代码管理，并把仓库状态算成装饰数据 |
| `business/workbench/editor-tabs.tsx`（新） | 标签条（标题 + 关闭两个同级按钮，窄屏带返回箭头） |
| `business/workbench/editor-area.tsx`（新） | 按激活文档分派 `FileContent` / `GitFileDiff` / `CommitDetail` |
| `business/workbench/workbench-panel.tsx` | 组合：活动栏 + `[侧栏 \| 编辑器]` 分栏（侧栏收起则编辑器占满）；窄屏互斥 |
| `business/workbench/git-file-diff.tsx` | 单文件标签：工具条（展示方式 / 换行 / 全部展开收起）+ `DiffViewer` |
| `business/workbench/diff-viewer.tsx`（新） | diff 本体：把 hunk 与两侧原文交给库渲染（单文件与堆叠共用） |
| `business/workbench/diff-controls.tsx`（新） | 展示方式与换行的控件（两个视图共用） |
| `business/workbench/changes-stack.tsx`（新） | 「全部改动」：头部工具条 + 分组，卡片交给 `diff-stack` |
| `business/workbench/diff-stack.tsx`（新） | 堆叠的 diff 卡片（「全部改动」与提交详情共用）：文件头吸顶、可折起、进入视口才挂载 |
| `business/workbench/path-context-menu.tsx`（新） | 路径行的右键菜单（文件树与 git 变更树共用） |
| `base/context-menu.tsx`（新） | 右键菜单（标签条用）；shadcn CLI 的 radix-nova 版，按仓库约定整理（去 `"use client"`、`IconPlaceholder` → lucide、去掉项目未定义的 nova 专用类） |
| `hooks/use-file-diff.ts`（新） | 一个文件 diff 的全部输入：hunk + 两侧原文 + shiki 适配器 |
| `hooks/use-diff-prefs.ts`（新） | 展示方式与换行的偏好状态（读写同一组 localStorage 键） |
| `hooks/use-in-view.ts`（新） | 「进入过视口」的一次性判定（堆叠视图的懒挂载） |
| `business/diff-view.tsx` | 消息流里的行内 diff（工具调用的改动）；git diff 走库，两者是两条路 |
| `business/workbench/panel-tabs.tsx`、`review-content.tsx`（删） | 被活动栏与 `editor-area` 取代 |

## 边界

- 侧栏宽度按栏记像素（`<slug>-panels-workbench`）；侧栏视图与可见性不落盘，面板收起后再打开回到默认视图（代码管理，活动栏里也排在第一位）
- 侧栏顶部是**固定 36px** 的一行控件（见 `DESIGN.md`「面板内部」），两个视图同高，切视图时列表不跳；项目名进筛选框的 placeholder（不再单独占位），代码管理的增删合计在侧栏窄于 224px 时让位（容器查询）
- 打开文件不改侧栏视图：编辑器标签已经表达打开了什么，侧栏留在用户当前看的位置
- 切会话（工作目录变化）清空全部标签：标签里的路径都绑在旧目录上
- 没有工作目录（助理会话）时侧栏给占位；不在仓库内时代码管理视图给空态 + 「看项目文件」按钮
- diff 的「全部收起 / 全部展开」直接调库的 `onAllCollapse` / `onAllExpand`（按当前 Split / Unified 分别生效）
- 标签条支持右键：关闭标签 / 关闭其他 / 关闭全部（`lib/workbench-docs` 的 `closeOthers` / `closeAll`；右键的那个已不在时不动，否则会把标签全清掉）
- 提交详情与「全部改动」共用 `diff-stack` 的卡片：点历史里的提交直接铺出该提交各文件的 diff（`source: "commit"`）
- 库不带虚拟化：一个巨大文件「全部展开」会真的铺出所有行，收回要靠用户自己点
- 堆叠视图的文件头用 `sticky top-0` 吸顶，两处连带讲究：卡片**不能用 `overflow-hidden`**（它会把
  卡片变成滚动参照物，吸顶失效，圆角改由卡片自身与头部的 `rounded-*` 提供）；滚动容器顶部**不留
  内边距**（`px-2 pb-2` + 首个块 `pt-2`），否则吸顶处会露出 8px 空隙。分隔线画在内容块上而不是
  sticky 的文件头上，折起时内容不渲染，线自然消失
