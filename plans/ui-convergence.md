# 界面收敛与输入 / 消息区修订（含附件内联、命令参数化、内置 review）

> 来源：`TODO.md` 的「界面收敛 · 侧栏 / 输入区 / 消息区 / 工作台与全局」四组 + 「内置 `review` 命令」，
> 外加本轮追加的四项：`/goal` 参数型命令的 bug、用户消息底部操作行、复制消息、附件内联 + 编辑态复用编辑器。
> 状态：**进行中**。批次一已落地大半（见 §五「进度」），批次二未开工。

## 一、范围

| 批次 | 内容 |
| --- | --- |
| 批次一 | F `/goal` 等参数型命令修复 · A 侧栏四项 · B 输入区两项 · C 消息区（chip / 命令展开 / 折叠 / 复制 / 底部操作行）· D 工作台与全局两项 · E 内置 `review` 命令 |
| 批次二 | 附件在编辑器里内联成 chip（图片与文件一视同仁）+ 编辑重发复用输入区编辑器（附件一起重发） |

批次二的两个前置事实（本轮调研确认，写在这里避免重复踩）：

1. **图片在模型侧无法落在句子中间**。pi 的 `prompt(text, images)`（`pi-coding-agent/dist/core/agent-session.d.ts`）
   只接受「一整段文本 + 图片数组」，内部拼成 `[{type:"text"}, ...images]` 写进会话 JSONL，
   `server/src/core/serialize.ts` 的 `blocksOf` 也是按这个顺序投影文本块与图片块。
   所以内联在**编辑器里是真的内联**，发出去只能表达成「正文里的标记 + 按同一顺序附在末尾的图片」，
   模型靠标记里的序号对上第 N 张图。要真正交错内容块得等 pi 暴露 content parts。
2. **编辑重发现在没有复用输入区编辑器**：`business/message-item.tsx` 里是一个 `rows={3}` 的 `<textarea>`，
   且 `messageEditInputSchema`（`packages/contracts/src/messages/input.ts`）只有 `sessionId` / `entryId` / `text`，
   `admitEdit`（`server/src/core/run.ts`）也不走 `buildPrompt`——所以带附件 / 图片的消息一经编辑，附件必丢。

## 二、已锁定决策

1. **附件内联的范围是「图片与非图片都内联」**，编辑器里都是原子 chip，正文里都留位置标记；
   非图片附件的引用行在原位展开，图片按顺序附在末尾（受上面事实 1 限制）。
2. **编辑重发改用同一个 composer 编辑器**（完整复用）：`@` 引用、`/` 命令、附件 chip 都能还原并可点击预览，
   重发时附件一起带上（契约扩展）。**不做**「复用编辑器但附件不重发」的中间档。
3. **输入区的撤销 / 重做只覆盖编辑器文档**（含 mention 与命令节点），附件条不在编辑器文档里，不进历史。
4. **复制消息**：用户消息复制用户原文（剥掉前置展开块、保留 `@路径` 标记的写法）；
   assistant 复制该条消息的正文块（不含思考与工具调用），入口在轮末页脚行。
5. **附件内联后的正文标记用统一命名**（便于无歧义解析）：图片 `图片 N`、非图片 `附件 N.<ext>`；
   用户手打出的同名假标记不会误伤——解析要求「标记顺序与附件顺序一致」，不一致就整段退回现状的前置引用。
6. **`/goal` 是参数型命令**：菜单与命令面板选中它只把 `/goal ` 填进输入框，不立即执行；
   裸 `/goal` 回车由 `parseGoalCommand` 处理（有目标刷新目标栏、无目标提示），带参数则设定目标。

## 三、批次一逐项方案

### F. 参数型内置命令的 bug（先做，单独一个提交）

**根因**：`BuiltinCommand` 表达不了「需要正文参数」，三个入口全部默认「选中即执行」：

| 入口 | 现状代码 | 症状 |
| --- | --- | --- |
| `/` 菜单选中 | `business/composer/editor.tsx` suggestion 的 `item.builtin` 分支：`deleteRange` + `onBuiltin` | 立即执行，没机会写目标文本 |
| 手打回车 | `business/composer.tsx` 的 `builtinIdOf`（要求整条就是命令名） | 命中后同样立即执行，永远到不了 `chat-panel` 的 `parseGoalCommand`，裸 `/goal` 看状态也失效 |
| ⌘K 面板 | `business/command-palette.tsx` → `onRunBuiltin("goal")` | 同第一条 |

同类排查结论：13 个内置命令里只有 `goal` 需要正文参数（`rename` 走弹层输入，其余无参）。
顺带发现：⌘K 面板没有按 `needsSession` 过滤，草稿态会列出 `/archive`、`/compact` 并且选中后静默无反应。

**改法**：

- `lib/builtin-commands.ts`：`BuiltinCommand` 加 `takesArgument?: boolean` 与 `argumentHint?: string`；
  `goal` 标两者；把 `builtinIdOf` 从 composer 抽成 `builtinCommandIdOf`，**跳过参数型命令**。
- `business/composer/suggestion.ts` 的 `SuggestionItem` 加 `takesArgument`；`composer.tsx` 的 `commandItems` 带上它并把
  `argumentHint` 拼进 hint。
- `business/composer/editor.tsx`：`takesArgument` 时插入 `` `/goal ` `` 文本（焦点留末尾），不调 `onBuiltin`。
- `presets/workspace-layout.tsx` 的 `runBuiltin("goal")`：改成往当前草稿填入 `/goal `（编辑器重挂载即聚焦）；
  `/help` 清单显示 `/goal <参数提示>`；给 `CommandPalette` 传 `hasSession` 过滤 `needsSession`。
- 新增 `lib/__tests__/builtin-commands.test.ts`。

**不改**：带 `@` 引用或附件时打的 `/goal xxx` 仍按普通消息发送（`chat-panel` 的 `isPlainText` 判断）。

### A. 侧栏

1. **分组排序按项目首次创建时间**：`lib/session-groups.ts` 的排序键改成组内最早 `createdAt` 降序（组内仍按
   `updatedAt` 降序），新项目排最前且不再随发消息跳动；新增 `lib/__tests__/session-groups.test.ts`。
2. **分隔条叠到侧栏**：`workspace-layout.tsx` 侧栏侧 `<ResizableHandle>` 加 `-ml-3`——12px 命中区正好盖住
   「列表 `px-2` 8px + 行 `pr-1` 4px」这段侧栏右边缘空白，不额外占宽（也不压住悬停出现的置顶 / 归档按钮），
   侧栏内容与对话区卡片之间只剩单边 8px。`DESIGN.md`「分栏」同步改口径。
3. **状态图标对齐**：`business/session-list-item.tsx` 的状态图标统一 `size-4`（含 Spinner），槽位去掉
   `justify-center` 改左对齐、宽度仍 `w-6`，与项目行的文件夹图标同列、两侧标题起点不变。
4. **对话区头部**：删掉「新建任务」按钮与 `onNewTask` 的整条传参链（`chat-header` → `chat-panel` →
   `workspace-layout`；`command-palette` 的同名入口保留）；标题溢出处包 `SessionTitle`（实测
   `scrollWidth > clientWidth`，仅溢出时挂 `Tooltip`），双击走 `workspace-layout` 已有的 `requestRename`。

### B. 输入区

5. **撤销 / 重做**：不新增依赖，用已装的 `@tiptap/pm/history` 包一个 `Extension`（`history()` 插件 +
   `Mod-z` / `Mod-Shift-z` / `Mod-y`）；附件条不进历史。
6. **去掉输入区上方边框**：`business/composer.tsx` 外层删 `border-t border-border`（`GoalBar` 与子会话提示行
   自带 `border-t`，不受影响）。

### C. 消息区

7. **`@` 引用 / 技能 / 命令渲染成 chip**：
   - `lib/message-chips.ts`：`parseUserMessage` 改成**段落化解析**并一次写足（批次二直接复用）——
     收集 `<context path>` 的相对路径用于在正文里精确定位 `@路径`（不误伤用户自己打的 `@张三`），
     剥离新的 `<command name="…" args="…">` 块并还原 `{ name, args }`。
   - `server/src/core/run.ts`：`buildPrompt` 拆成「上下文 / 附件准备（不依赖会话）」+「命令展开后拼装」；
     `/name args` 在 `ensure` 之后用 `session.promptTemplates` 自己展开成 `<command>` 不可信边界块
     （复用 `harness/tools/untrusted` 的 `wrapUntrusted`），展开逻辑落 `server/src/harness/assets/expand.ts`，
     `$ARGUMENTS` / `$@` / `$N` / `${N:-默认}` / `${@:N:L}` 的语义对齐 pi 的 `substituteArgs`
     （该函数未从包入口导出，需自己实现并配 `__tests__/expand.test.ts`）。pi 侧不会再重复展开（body 不再以 `/` 开头）。
   - `business/message-item.tsx` 的用户消息分支抽成 `business/user-message.tsx`：四类 chip 同一套样式；
     引用 chip 可点，走 `useWorkbench().openPreview(resolveFromCwd(cwd, path))`，无 Provider 时退化为纯文本；
     命令 chip 显示 `/name`，`args` 作为正文跟在后面。
8. **用户消息过长折叠**：最大高度 + 溢出检测（`scrollHeight > clientHeight`）+ 底部渐隐 + 「展开 / 收起」；
   文案 key `展开` / `收起` 补进 `packages/i18n/src/locales/ui/en.ts`；虚拟列表已挂 `measureElement`，高度变化会被重测。
9. **用户消息的底部操作行**：把现在竖排在气泡左侧的「时间 / 编辑 / 分叉」移到气泡**下方**一行，
   顺序 `时间 · 分叉 · 编辑 · 复制`，与气泡右对齐；沿用页脚行的做法——`min-h-6` 常驻占位（hover 出现时不顶动内容）、
   `opacity-0 group-hover:opacity-100 focus-within:opacity-100`；`EditAction` / `ForkAction` 一并搬进 `user-message.tsx`。
10. **复制消息**：新增共享 `CopyAction`（放 `business/message-footer.tsx`，与 `ForkAction` 同处，两处操作行共用）：
    `navigator.clipboard.writeText`，成功后图标换 `Check` 约 1.5s，失败（非安全上下文 / 无权限）静默保持原状。
    用户消息复制 `parsed.text`；assistant 在 `MessageFooter` 右侧加 `[复制] [分叉]`，复制该条消息的 `text` 块拼接。
    新增文案 `复制` / `已复制`；`DESIGN.md`「消息区」同步用户消息与 assistant 页脚两行。

### D. 工作台与全局

11. **工作台展开状态持久化 + 尺寸**：`workspace-layout.tsx` 的 `workbenchOpen` 初值与写入接
    `localStorage`（键 `${brand.slug}-workbench-open`，照侧栏同法），所有开关收敛到 `applyWorkbenchOpen`；
    `lib/panel-layout.ts` 的 `WORKBENCH_PANEL.max` 720 → 1200，新增 `CHAT_MIN_WIDTH = 400` 并给对话区面板
    `minSize`；`DESIGN.md`「分栏」表同步。
12. **全局滚动条**：`styles/theme.css` 的 base 层统一（`scrollbar-width: thin` + `scrollbar-color: var(--border) transparent`，
    以及 `::-webkit-scrollbar-*` 一套：宽 8px、圆头 thumb、hover 用 `--muted-foreground`），颜色全走语义 token 故
    `.dark` 自动跟随；`DESIGN.md` 补一条落位说明。

### E. 内置 `review` 命令

13. `packages/contracts/src/constants.ts` 的 `COMMAND_ASSET_SOURCES` 末尾加 `"builtin"`（最低优先级）并改注释口径
    「项目 `.ucode` → 项目 `.agents` → 全局 `$APP_HOME` → 用户 `~/.agents` → 内置」；重跑 `pnpm api:docs`。
14. 新增 `server/src/harness/assets/builtin.ts`（正文即 `.agents/commands/review.md` 的内容，源码内常量，打包后可读）；
    `harness/assets/index.ts` 放宽「无目录即空集」早退、合并内置（磁盘同名跳过）、内置来源标 `builtin`；
    `harness/session-config.ts` 的 loader 用 `promptsOverride` 追加未被占用的内置命令（`createSyntheticSourceInfo`
    造合成路径）；`assets/__tests__/assets.test.ts` 补「无磁盘目录仍有内置 `/review`」与「磁盘同名覆盖内置」。
15. 仓库自带的 `.agents/commands/review.md` **保留**（同名优先级更高，本地仍可随手改）；`CHANGELOG.md` 记
    「新增内置提示词命令」与「`commands` 响应的 `source` 增加 `builtin`」。

## 四、批次二方案（附件内联 + 编辑态复用编辑器）

**编辑器与文档模型**（✓ 全部落地）

- 新增原子节点 `attachmentMention`，attrs `{ id, name, kind, tempId }`；粘贴 / 拖拽先插占位 chip（Tiptap
  React 节点视图：图片显缩略图、点缩略图开预览，其余显图标 + 文件名），拿到 id 后按 `tempId` 就地补上；
  `submit` 的 `hasPendingUploads` 守卫保留。
- `lib/composer-document.ts` 的 `docToPayload`：按节点出现顺序收集 `attachments`（id 列表）并在正文原位写标记。
- 去掉 `business/composer/attachment-strip.tsx`；预览抽成 `business/attachment-preview.tsx`（`useAttachmentPreview()`
  + `AttachmentThumb`），编辑器 chip 与历史消息 chip 共用。
- `useComposerAttachments` 保留为上传入口（只是改成驱动编辑器句柄）；草稿不再单存附件视图，靠 doc 里的节点 attrs。

**协议**（✓ 落地，写进 `docs/session-entries.md`「正文里的位置标记」）

- 常量与扫描器收进 `packages/contracts/src/messages/markers.ts`，两端共用一份：图片 `图片 N`、
  非图片 `附件 N.<ext>`（N 按各自类型在本条消息内的出现顺序）；展开后的引用行构造函数也在那里。
- 服务端（`harness/attachment/inline.ts`）按标记顺序就地展开：非图片换成引用行、图片标记留着（本体按标记顺序
  进 vision 数组）。对得上的条件是「数量一致 + 各自 1..N 连续升序 + 非图片写出的扩展名与该附件相同」；
  对不上（用户手打了同名标记、附件被删了一个）整段退回「引用行前置 + 图片按原顺序」的老路径。

**回放**（✓ 落地）

- 历史消息按段落化结果渲染：图片按「标记序号 ↔ 第 N 个 `image` block」插回句子中间，media 区只兜底没有标记的
  图片（早期消息）与文件块；非图片的引用行（含早期消息的前置写法）就地还原成可下载 chip。

**编辑态**（✓ 全部落地）

- 契约 `messageEditInputSchema` 加 `contexts` / `attachments`（与 `promptInputSchema` 同形）；
  SDK 的 `messages.edit` 与 `packages/ui` 的 `chat.edit` 签名跟改；`admitEdit` 改走 `preparePrompt` / `assemblePrompt`
  并 `markReferenced`；`@` 引用的 `path` 放宽到「绝对或会话工作目录相对」——编辑重发回传的是相对写法。
- 新增 `lib/message-document.ts` 的 `messageTextToDoc(parsed, images)`：把「前置展开块 + 正文标记」还原成 Tiptap
  文档（`contextMention` / `commandMention` / `attachmentMention`），与回放的段落解析共用同一条扫描；
  命令 / 技能还原成 mention 节点，参数跟在后面。
- 编辑器抽成可复用组件（编辑态：`/` 菜单停用、命令节点只读、`@` 检索用会话 cwd、可继续贴图，
  Enter 发送 / Esc 取消），`business/message-edit-form.tsx` 替换原来的 textarea。
- 编辑走「文档 → `docToPayload` → 与首次发送同一套换算（`relativizeContextRefs`）」，附件与引用不再因为改写走样。

## 五、进度

**已落地（批次一全部 + 批次二的编辑态协议部分）**

- F 组全部：`lib/builtin-commands.ts`、`lib/__tests__/builtin-commands.test.ts`（新）、`business/composer.tsx`、
  `business/composer/editor.tsx`、`business/command-palette.tsx`、`presets/workspace-layout.tsx`。
- A 组：`lib/session-groups.ts` + `lib/__tests__/session-groups.test.ts`（新）、`business/session-list-item.tsx`、
  `business/chat-header.tsx`、`business/chat-panel.tsx`、`workspace-layout.tsx`（分隔条 `-ml-3`、`onRenameSession`）。
- B 组：`business/composer/editor.tsx`（历史扩展）、`business/composer.tsx`（去掉 `border-t`）。
- C 组：`lib/message-chips.ts`（段落化解析 + 命令 chip + 引用分段）、`server/src/harness/assets/expand.ts`（新）、
  `server/src/harness/tools/untrusted.ts`（`command` 边界）、`server/src/core/run.ts`（`preparePrompt` / `assemblePrompt`）、
  `business/message-blocks.tsx`（新，内容块抽取）、`business/user-message.tsx`（新）、`business/message-item.tsx`、
  `business/message-footer.tsx`（`CopyAction`）。
- D 组：`lib/panel-layout.ts`、`workspace-layout.tsx`、`styles/theme.css`（全局滚动条）。
- E 组：`server/src/harness/assets/builtin.ts`（新）、`assets/index.ts`、`harness/session-config.ts`、
  `packages/contracts/src/constants.ts`、`assets/__tests__/assets.test.ts`、`docs/api-reference.md`（重跑 `pnpm api:docs`）。
- 文档与文案：`DESIGN.md`（分栏 / 消息区 / 滚动条）、`packages/i18n`（`复制` / `已复制`）、`CHANGELOG.md`、`TODO.md`。

- 批次二（全部落地）：`packages/contracts/src/messages/markers.ts`（新）、`server/src/harness/attachment/inline.ts`（新）
  + `__tests__/inline.test.ts`（新）、`server/src/core/run.ts`（按标记内联）、`packages/ui/src/lib/composer-document.ts`、
  `lib/message-chips.ts`、`lib/message-document.ts`（新）+ `__tests__/message-document.test.ts`（新）、
  `business/attachment-preview.tsx`（新）、`business/composer/attachment-chip.tsx`（新）、`composer/editor.tsx`
  （可复用 + 附件节点）、`composer/use-composer-attachments.ts`、`composer.tsx`、`business/message-edit-form.tsx`（新）、
  `business/user-message.tsx`、`business/chat-panel.tsx`、`lib/composer-draft.ts`、`docs/session-entries.md`。
- 顺带修掉两个真问题（都在本批次的编辑路径上）：`message_end` 实时帧的临时 id 让「发完立刻改 / 分叉」必失败
  （`server/src/core/event-bus.ts` + `events.ts` 推迟一帧补真实条目 id）、编辑态新加的 `@` 引用没换算相对写法导致回放认不出。

**未落地**

- 无（两个批次全部落地）。

## 六、验证

- 每批结束跑 `pnpm check`（`biome check .` + 各包 typecheck + 单测 + `pnpm verify`）。**批次一已全绿**（含 9 项约定校验）。
- UI 改动在真实浏览器里逐项过：`pnpm build && pnpm start` 开 `http://127.0.0.1:19688`，或 `pnpm dev` 开 `:5173`。

**批次一 + 编辑态协议实测确认**（另起一个临时实例：`APP_HOME=.tmp/verify APP_PORT=19690 pnpm -F @ucode/server dev` +
`APP_PORT=19690 pnpm -F @ucode/web dev`，不影响正在跑的 19688）：

- `/` 菜单里 `/goal` 带上了参数提示；选中只填入 `/goal `，不立即执行。
- 未在磁盘目录里的工作目录，`commands/list` 返回 `/review` 且 `source` 为 `builtin`；投递后会话条目里的正文是
  `<command name="review" args="">…</command>`，界面只出一个 `/review` chip。
- **技能带引用也会展开**：`contexts: [{ path: "note.md" }]`（相对写法）+ 正文 `/skill:tiny 看看 @note.md`
  落盘为 `<context path="note.md">` + `<skill name="tiny" …>` + 正文（修复前整条不展开）。
- 技能消息渲染成 `tiny` chip + 正文里可点的 `@note.md` chip（`title` 为「预览 note.md」）。
- **编辑重发保留引用与技能**：把一个 118 字标题的长会话里的技能消息改成
  `/skill:tiny 再帮我看看 @note.md 有没有遗漏` 重发，新条目仍是 `<context>` + `<skill>` + 新正文。
- 用户消息底部操作行含「分叉 / 编辑 / 复制」与时刻；assistant 轮页脚含「复制 / 分叉」。
- 长消息折叠：气泡限高 320px + 底部渐隐，「展开 / 收起」可来回切换。
- 复制：`lib/clipboard` 先试异步剪贴板 API，不可用或被拒时退回临时 `textarea` + `execCommand("copy")`。
  实测（自动化浏览器不给剪贴板权限）：删掉 `navigator.clipboard` 后点复制，`execCommand` 收到的选中文本
  正是整条消息、返回 true，图标切到「已复制」；不删则先报 `NotAllowedError` 再走同一兼底。
  系统剪贴板本身无法在自动化实例里校验（该实例连真实 ⌘C 都写不进 macOS 剪贴板）。
- ⌘Z / ⌘⇧Z / ⌘Y：正文分两步输入后逐个回退、再逐个恢复，⌘Y 也能重做。
- 会话标题：118 字标题实测 `scrollWidth 1499 > clientWidth 713` → 只在这种情况下挂 tooltip，派发 pointer
  事件后 tooltip 弹出全名；改回短标题后不挂。双击标题弹出重命名弹层，保存后标题与侧栏同步。
- 分隔条：侧栏侧命中区占 `[276, 288]`（侧栏右边缘往内 12px），行内「归档」按钮占 `[252, 276]`，重叠 0；
  拖拽生效并卡在面板上下限（侧栏拖到头停在 400）。
- 工作台：展开后 `localStorage` 为 `1`，刷新仍展开且宽度保留（505px）；拖拽时对话区卡在下限 **400**。
- 滚动条：`scrollbar-width: thin`、thumb 8px 圆头；浅色 `--border` 解析为 `oklch(0.922 0 0)`、
  深色为 `oklch(1 0 0 / 0.12)`，两套主题都跟随语义 token。
**批次二实测确认**（同一个临时实例，改用「粘贴事件注入 + 真实鼠标/键盘事件」驱动）：

- 输入区里粘贴「一张图 + 一个文本文件」：正文中间就地出现缩略图 chip 与 `c.txt` chip（截图确认），
  编辑器上方不再有附件行。
- 投递后会话条目是 `C组 图片 1 [附件: c.txt (id: <sha256>)]  结束` + 一个 image 块——非图片标记就地换成引用行、
  图片标记留着且本体进 vision 数组 ✓；界面里同一条消息渲染成「内联缩略图 + 可下载的 c.txt chip + 文字」，
  气泡下没有独立 media 行。
- 点内联缩略图（真实 mousedown）弹出「图片预览」；编辑器里 chip 的缩略图同样弹层（其余区域仍是原子节点）。
- 编辑态：点「编辑并重新发送」后，编辑器把图片与文件都还原成 chip，正文原样；Backspace 删掉文件 chip
  （2 → 1）后重发，新条目是 `C组 图片 1   结束` + 一个 image 块（引用行消失，图片保留）。
- 编辑态 `/` 菜单停用（在文档开头敲 `/` 不弹层）；Esc 取消编辑（编辑器与按钮一起收回）。
- 编辑态 `@` 检索用会话 cwd：敲 `@note` 列出工作目录里的 `note-md.txt`，选中后重发的条目带
  `<context path="note-md.txt">`，正文标记也是相对写法，回放能认出 `@note-md.txt` chip。
- 兜底回放（curl 直接投递）：正文写 `附件 1.md` 而附件是 `c.txt` 时判为对不上 → 引用行前置、
  用户的话一字未改；写 `附件 1.txt`（扩展名撞上）才会就地展开。
- 拒绝提示：粘贴 0 字节与 40MB 两个文件 → 一条「无法添加附件：empty.txt、big.bin」，两个都不入库。
- 草稿：输入区带一个图片 chip 时刷新页面，chip 与缩略图原样恢复（文档即草稿）。
- **发完立刻改**（修复前必 400）：投递 `新消息 B1` 后用编辑态改成 `新消息 B1 改过了`，`messages/edit` 的
  `entryId` 是真实条目 id（`d5a32796`）、响应 200，新条目落盘 ✓。
- **未实测**：`runBuiltin("goal")` 的 `!activeId` 守卫（按设计不可达：⌘K 与 `/` 菜单都会先按 `needsSession` 过滤）；
  上传中（占位 chip 还没拿到 id）按发送被 `hasPendingUploads` 挡住这条路径（要卡住本地上传才能复现）。
  必查：分组顺序不跳动、分隔条可拖且不压住行内按钮、状态图标与文件夹图标对齐、标题溢出 tooltip 与双击改名、
  `⌘Z` / `⌘⇧Z` / `⌘Y`、输入区上方无横线、引用 chip 点击开预览、命令 chip、用户消息折叠与展开、
  底部操作行（时间 / 分叉 / 编辑 / 复制）、复制成功态、工作台展开状态刷新后保持、工作台上限 1200 与对话区下限 400、
  滚动条深浅两色；`/` 菜单选 goal 只填入命令名、裸 `/goal` 回车给出状态或提示、`/new` 等仍立即执行。
- 提交按批次拆开（F 组单独一个提交），一个提交只做一个逻辑改动；用户明确要求提交后再执行。
- 每项完成后从 `TODO.md` 删除对应条目。
