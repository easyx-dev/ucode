# 工作台（右侧第三栏）：改动 / 文件预览

> 状态：**已实现**。契约见 `docs/api.md`「文件系统（fs）」「Git（只读）」，视觉规则见 `DESIGN.md`
> 「分栏」「面板内部」「语法高亮」。面板的版式与信息架构见 [`workbench-panel-layout.md`](./workbench-panel-layout.md)；
> 内置浏览器不在本文范围，见 [`builtin-browser.md`](./builtin-browser.md)。

## 目标

对话区右侧增加第三栏，默认收起，展开后是一套「只读的简易工作台」：

- **改动**：当前项目（会话 cwd）的 git 工作区改动与提交历史，点开看 diff。
- **文件**：目录树 + 文件预览，两者并列、之间可拖拽分栏。
- 对话区工具行的路径入参、文件树、⌘K 的文件结果都能打开预览（用户消息里的 `@` 引用暂未接入，它现在是正文文本）。

明确不做：任何写操作（stage / commit / checkout / 编辑）、语法级跳转、搜索替换、终端。

## 分层

```
packages/contracts      fs/read、git/*（请求 zod + 响应类型，含展开未变更区域用的 git/contents）
server/lib/file-content 读文件内容（二进制嗅探、内联上限、截断）
server/lib/git          git 执行底座 + status/diff/log/contents 解析（零依赖，调系统 git）
server/routes/{fs,git}  路由（fs 域加一条，git 域新增五项）
packages/sdk            apis.fs.read / apis.git.*
packages/ui/lib         preview（类别分派）、shiki（高亮）、panel-layout（栏宽）、git-marks / git-groups（标记与分组）、
                        git-patch（hunk → patch 文本）、workbench-docs（标签）
packages/ui/hooks       use-async-data（key + reloadToken 取数形态）、use-workbench-data、use-workbench-docs、
                        use-git-review、use-highlighted-lines
packages/ui/provider    WorkbenchProvider（面板状态在预设、动作经 context 下发）
packages/ui/business/workbench  活动栏 / 侧栏 / 编辑器区 / 文件树 / 各类渲染器 / git 三层视图
packages/ui/base        resizable（shadcn 生成的分栏容器 / 面板 / 分隔条）
```

## 关键决策

**预览器做成独立子系统，而不是「文件树的一部分」。** 预览目标（`PreviewTarget`）与类别分派
（`lib/preview.ts`）独立于目录树，渲染器按类别注册（`text` / `markdown` / `image`，PDF 与 Office
先占位）。后续接 pdf.js / mammoth、或让对话区的附件也走预览，都只加渲染器不动宿主。

**内容形态由服务端判定，类型只决定渲染器。** 扩展名决定「用哪种渲染器展示」，`fs/read` 的
`kind: text | binary` 决定「拿到的是文本还是 base64」。二者不一致时统一落到占位态，
这种判断只在预览宿主里做一次。

**相对路径在客户端拼成绝对路径。** 工具入参与 `@` 引用里的路径多半相对会话 cwd，
而服务端解析相对路径的基准是**服务进程的 cwd**，因此 `lib/path.ts` 的 `resolveFromCwd`
负责拼接，服务端只接受绝对路径。

**git 只读、零依赖。** pi SDK 不提供 git API，服务端直接用 `execFile` 调系统 git：
全局参数（`--no-pager`、`core.quotepath=false`）落在子命令之前，diff 参数
（`--no-ext-diff` / `--no-textconv` / `--no-color`）在子命令之后——git 的全局选项与子命令选项
不能混放。用户可控入参只有「仓库内相对路径」与「提交引用」，两者都在服务端校验。
diff 由服务端解析成结构化 hunk（`lib/git/diff.ts`），客户端不做文本解析。

**行数统计用 `--no-renames`。** 这样 `--numstat -z` 的每条记录都是「增 删 路径」三个字段，
不必处理重命名那种「空路径 + 双路径」的特例；代价是重命名条目拿不到行数，按契约给 `null`。

**高亮用 shiki 的 fine-grained 用法。** `shiki/core` + JS RegExp 引擎（不引 Oniguruma WASM：
官方兼容表 237/238 种语言与 WASM 一致，唯一不支持的 `ahk2` 不在语言表内）+ 按需语言。
颜色不写十六进制，主题直接写 `var(--code-*)`，变量取自既有语义 token，深浅色自动跟随。
渲染走 `codeToTokens`（结果本就按行分组）而不是 `codeToHtml`，因此不需要
`dangerouslySetInnerHTML`，行号 / 横向滚动 / 截断都留在渲染器手里。

**面板状态在预设里受控，动作经 context 下发。** 对话区的组件（工具行、消息、命令面板）与面板隔着
多层组件，因此 `WorkbenchProvider` 只暴露只读快照 + 动作；`useWorkbench()` 在没有 Provider 时
返回 `null`，消息区组件可以脱离工作台单独复用。面板内部是「活动栏 + 侧栏 + 编辑器区」三区，
打开的文档（文件预览 / diff / 提交详情）在预设里以标签集合的形式交给编辑器区，
版式与交互见 [`workbench-panel-layout.md`](./workbench-panel-layout.md)。

**刷新靠三个入口，不轮询。** 服务端没有文件变更推送，所以：手动刷新按钮、打开面板时拉一次、
每轮对话结束（`agent_settled`）后刷新——agent 刚改过的文件要出现在变更列表里。
状态挂在面板这一层，因此切「改动 / 文件」标签不会重取（历史视图的提交列表会，它按需挂载）。

## 边界与已知取舍

- 未跟踪文件的行数不给（git 不统计），diff 用 `git diff --no-index /dev/null <file>` 比出全文新增。
- 单层目录超过 200 项只渲染前 200 项（`node_modules` 能上万项）；预览默认最多渲染 5000 行；
  高亮阈值 3000 行 / 200KB。
- 编辑器区最多同时开 8 个标签（文件预览 / diff / 提交详情混算），超出丢最早的那个。
- 未变更区域的展开依赖 `git/contents`：两侧原文超 1MB 或二进制时那些区域展不开，其余照常显示
  （展开步长 40 行，由 `@git-diff-view/react` 定）。
- 未绑定目录的会话落在 `$APP_HOME/workspace/<id>`：该目录若落在某个仓库内（开发时 `APP_HOME` 常在仓库里）
  就显示那个仓库的改动，否则（生产默认 `~/.ucode`）给空态。
- 分栏用 shadcn 的 `Resizable`（`react-resizable-panels`）：尺寸按像素、每栏各记一份，
  拖拽 / 双击复位 / 方向键都由库提供；分隔条不画线，可见分界用面板自己的边框（文件树 `border-r`）。

## 验证

- 单测：`server/src/lib/git/__tests__/git.test.ts`（真实临时仓库上跑 status / diff / log / show / contents、
  路径与 hash 校验）、`server/src/lib/file-content/__tests__/file-content.test.ts`、
  `packages/ui/src/lib/__tests__/{preview,shiki,path,panel-layout,git-marks,git-groups,git-tree,git-patch,diff-prefs,workbench-docs}.test.ts`。
- `pnpm check`（biome + typecheck + test + verify）。
- 手工：`pnpm dev` 开 `:5173`，验活动栏切视图、侧栏拖宽 / 收起、多标签、双栏 diff、折叠与全部展开收起、
  文件树的 git 装饰、目录树、预览（含高亮与深色模式）、git 改动与历史；缩到 768px 以下验窄屏互斥。
