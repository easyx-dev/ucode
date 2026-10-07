# TODO

只列**未完成**的条目，做完即删。历史看 [`CHANGELOG.md`](./CHANGELOG.md)，逐项落位看 [`plans/`](./plans/)。

---

## 需求 · 新会话标题并行生成

**现象**：标题现在挂在事件总线的 `agent_settled` 上（`server/src/harness/title/index.ts`），而 `firstExchange`
又要求首条助手回复已存在，于是标题必须等整轮对话跑完才出现——新会话在侧栏列表里长时间没有名字，
轮次越长越明显。

**待办**：改为并行生成——首条用户消息发出时就发起一次模型调用（只喂用户提问），与这一轮的对话同时跑，
标题尽早回填；`apply` 的既有约束（用户自己命名优先、子会话不覆盖、只往池内那个 sessionManager 追加）保持不变。
要一并处理：`agent_settled` 之后是否再用完整交流补一次、超时与失败时的回落口径、`firstExchange` 与
`TITLE_MAX_USER_TURNS` 的取舍，以及 `harness/title/__tests__/` 的用例调整。

---

## 需求 · 权限 / 问答 / plan 弹窗的形态与样式（原「样式」条目已并入）

**现象**：三处需要用户决策的界面形态不一致。权限弹窗（`packages/ui/src/business/permission-dialog.tsx`）
与问答弹窗（`packages/ui/src/business/question-dialog.tsx`）都是 `base/dialog` 的全屏遮罩弹窗，
在应用级挂载（`packages/ui/src/presets/workspace-layout.tsx:567` / `:574`）；而 plan 的决策表单
（`plan-decision-form.tsx`）是内嵌在输入区位置、直接替掉 Composer（`chat-panel.tsx:261-265` 的 `showPlanForm` 分支）。
另外观感偏粗：尺寸、标题与选项排布、按钮区都不统一，和对话区不在一个层次上；问答多题时内容很长，
全屏弹窗把对话遮住，用户想先看内容再作答也不方便。

**待办**：

1. 权限与问答弹窗改成与 plan 同样的形态：在对话输入区那一块覆盖，不再占满屏幕。
   需要把两个 interaction 从 `workspace-layout` 传进 `ChatPanel`（或抽一个共用的「决策区」槽位），
   并确认交互归属：interaction 带 `sourceSessionId`，而当前弹窗按全局待答项展示，多会话 / 子会话时
   应只在自己的面板里出现。
2. 问答表单支持收起：收起后只留一行摘要（第几 / 共几题、还有哪些未答），展开后继续作答；
   收起状态在 `requestId` 变化时重置（现有草稿就是这个口径）。
3. 样式参考 opencode 的同名弹窗重做（宽度与高度上限、标题与选项排布、主次按钮、键盘交互），
   约束到 `DESIGN.md` 的 token 与组件规范；具体视觉方案待确认。

**待确认**：覆盖是「替掉 Composer」还是「浮在 Composer 之上、保留输入」；未答完就收起的口径；
问答是否允许多题分步作答。

---

## 需求 · 侧栏底部信息区改版

**现象**：侧栏底部（`packages/ui/src/business/session-sidebar.tsx:133`）是一道 `border-t border-sidebar-border`
加一个占满宽度的「设置」按钮，分隔方式生硬，入口也不像身份区。

**待办**：去掉上边框，改用很淡的投影做与列表的分隔；底部改成「左头像 + 名称、右侧单个图标按钮（设置）」的一行布局。
头像与名称先写死——用户名从哪来（登录态 / 配置项 / 占位）需要后续拍板，本轮不接。
`packages/ui/src/base/` 目前没有 avatar 组件：要么用 shadcn CLI 生成一个再按仓库规则整理（记得把 `@/` 导入改成包内相对路径、
`@/lib/utils` 改成从 `cn` 导入），要么直接用圆形字母块，取哪种需确认。

---

## 需求 · 会话行的点击区域过小

**现象**：`packages/ui/src/business/session-list-item.tsx:95` 的点击区（`session-list-item.tsx:97-101`）
只包住了图标槽与标题文字，行左侧的内边距、标题右侧到时间戳之间的空白都点不动——只有落到实处文字上才切换会话，
和视觉上的整行可点不一致。

**待办**：让整行高度与宽度都成为可点区域，同时保住现有的悬停操作（置顶 / 归档）与展开箭头、双击重命名不互相抢事件：
悬停按钮区当前靠绝对定位叠在行上，扩大点击区时要一并确认层级与 `pointer-events`。

---

## 需求 · 发送消息后自动回到底部

**现象**：贴底跟随只在「已在跟随」时生效——`packages/ui/src/business/message-list.tsx:143-154` 的 effect
先 `if (!followingRef.current) return`，而 `following` 由用户滚动改写（向上翻过就是 false）。
于是用户上翻查看历史后再发一条，新行只追加在列表末尾，视口停在原处，看不到自己刚发出去的那条。
（首次挂载与切会话有 `resetKey` 的 layout effect 强制到底，只有「非跟随时发送」这条路径漏了。）

**待办**：让发送这条路径显式要求回到底部，重新打开贴底跟随。发送入口在 `chat-panel.tsx:144` 的 `submit`
（且只有 `chat.send` 被接纳的那次算数，`admitted` 为 false 时不能动视口）。传递方式待定：
MessageList 加一个「已发送」的自增 props，或暴露命令式 handle。要一并确认：子会话只读视图里是否也生效、
用户上翻的历史位置在发送后是否直接丢弃（当前语义是丢弃）、以及浮出的「回到底部」按钮随状态更新的时机。

---

## 待定 · 内置供应商的「拉取模型列表」入口

设置页的「拉取模型列表」只出现在自定义供应商上：内置供应商的模型清单来自 pi 内置目录（只读、随升级更新），
要拉取就得先把结果落成 `models` 覆盖内置清单——属于另一件事，等确认要不要做。

---

## 暂缓（等明确指令再启动）

- **插件机制**：方案见 [`plans/plugins.md`](./plans/plugins.md)。
- **中继服务**：方案见 [`plans/relay.md`](./plans/relay.md)，前置的服务化与鉴权已落地。
- **内置 TODO 工具 / wiki**：暂无实现计划。
