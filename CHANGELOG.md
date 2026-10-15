# 变更日志

**何时更新**：改动涉及项目流程状态时——新增/调整 pnpm 脚本、环境变量、启动方式、依赖、目录结构、
对外接口。纯 bugfix、文案、内部重构不写。

**结构**：简体中文，倒序（最新在上）。

```md
## [未发布]

### 新增

- **桌面端内置浏览器面板**：工作台多一个「浏览器」视图（活动栏入口 + 侧栏标签列表），编辑器区里每个标签是
  一个 Electron `<webview>`（主进程开 `webviewTag`，并用 `will-attach-webview` 摘掉 guest 的 preload 与
  node 集成），带地址栏、前进 / 后退、刷新与开发者工具；多个标签共用一份持久 partition
  （`persist:<slug>-browser`），站点 cookie 与外壳页分开。web 端不注入这一面，工作台里就没有浏览器视图与标签。
  `<webview>` 的页面**常驻**：切标签只切可见性、换工作目录也留着（卸载即销毁页面）。
  新增 `pnpm -F @ucode/desktop browser:smoke`（真 Electron + 真界面驱动的端到端冒烟，见 `docs/browser.md`）。
- **桌面端浏览器通道**：桌面端把工作台里开了哪些浏览器标签、当前在看哪一个经
  `GET /api/v1/browser/desktop`（WebSocket）报给服务端——先带凭证换一次性票
  （`POST /api/v1/browser/desktop/ticket`），再接通道；另有只读的 `POST /api/v1/browser/desktop` 看当前状态
  （`connected` + 标签集合，每个标签带 `webContentsId`）。服务端据此知道该驱动哪一个（当前激活的那个），
  CDP 命令转发见下一条。桌面端新增依赖 `@ucode/contracts`（复用跨端的标签形状）。
- **桌面端浏览器驱动**：agent 现在能驱动桌面端面板里的那个页面——服务端把 CDP 命令经通道发给桌面端主进程，
  再由它转给目标 webview 的 `webContents.debugger`（桌面端只驱动自己创建的标签，其余 `webContentsId` 一律拒绝）。
  目标是**当前激活的标签**：`browser_open` 导航它、`browser_close` 只断开、切标签即换目标（编号表跟着作废）；
  想强制用受管实例就在 `browser_open` 里传 `profile` / `cdpEndpoint`。两条传输共用同一套语义
  （编号、遮挡判定、快照文本抽到 `page-ops`）。新增 `pnpm -F @ucode/server browser:desktop-smoke` 端到端冒烟。
- **页面元素选成上下文**：桌面端浏览器面板的工具条多一个「元素选择」——进点选模式后在页面上点一个元素，
  它的摘要会追加到当前会话的输入框末尾、随消息一起发给模型（`Esc` 取消）。字段按同类产品的共识取
  （Trae / Cursor Design Mode / ZCode 的网页元素上下文）：页面标题与地址、role 与可访问名、选择器（优先
  测试 id / id / name，退回带 class 的结构路径）、盒子坐标、颜色背景字体字重 display、属性（剔除内联事件）、
  元素文本、附近文本（父元素里除它以外的文本）、以及截断到 1500 字符并剔除内联事件的 `outerHTML` 片段；
  空值整行不写。**输入框里显示的是一枚芯片**（元素名 + 悬停给选择器），整段摘要只在发送时落进消息正文
  ——新增编辑器节点 `pageElementMention`，与附件 token 同一套做法。采集走 `<webview>.executeJavaScript`，
  与 agent 驱动那条 CDP 通道不相干。
- **浏览器画面帧流移除**：agent 看的画面改由桌面端 webview 承载，因此删掉了 CDP screencast 推流、握手票与
  `GET /api/v1/browser/stream`、`POST /api/v1/browser/ticket` 两个接口，以及 SDK 的 `createBrowserSocket`
  与工作台里的 canvas 面板；`browser/list` / `browser/delete`（profile 数据面）与服务端受管实例保留。
- …
- **内置浏览器工具集（能力层）**：服务进程内的 Playwright（headless）给 agent 提供
  `browser_open` / `browser_snapshot` / `browser_act` / `browser_screenshot` / `browser_close` 五个工具。
  元素带 `@eN` 编号（按可访问名哈希生成，导航后整体失效），被遮挡或编号失效时**立即失败**并给出下一步，
  不做自动等待与自动重试。快照含 `h1`–`h3` 标题、可交互元素与 `[role]` 语义节点，支持 `diff`（只回传变化，默认关）与
  `compact`（丢掉无名容器与视口外元素，默认关）。实例按 profile 名共享（引用计数 + 空闲回收），`browser_open` 默认走审批
  （匹配对象是目标站点），只读模式（plan / ask）对整组工具阻断、与 `bash` 同档。
  新增依赖 `playwright-core`（不下载内核，探测系统浏览器；探测失败给出试过的路径）。
- **浏览器 profile 的数据面与持久化**：`browser_open` 给了 `profile` 名就把数据长期保留在
  `$APP_HOME/app/browser/profiles/<name>`（目录 0700，里面有 cookie 与 localStorage），不传则用临时目录、
  实例关掉即删；实例按 profile 名共享（引用计数 + 空闲回收），同一份 profile 不能被两种数据目录同时打开。
  接口新增 `POST /api/v1/browser/list`（占用 / 最后使用时间 / 是否使用中 + 根目录与上限）与
  `POST /api/v1/browser/delete`（使用中与名字不合法的进 `skipped`，传全集即清空）。
- **浏览器工具的默认设置**：`config.json` 新增 `browser` 块——`mode`（自己启动受管实例 / attach 用户已有的调试实例）、
  `endpoint`、默认 `profile` 名，经 `config/update` 修改；`browser_open` 的工具入参仍可覆盖单次行为。
  这三项在调用工具时读取，改它不重建会话（与联网搜索同属惰性字段）。
- **设置页新增「浏览器」分节**：连接方式（自己启动 / 连接已有调试实例）、attach 的调试端点与默认 profile 名
  （进配置草稿，随「保存并生效」提交）；下面是已保留 profile 的实时列表——占用、最后使用时间、使用中标记，
  可单份删除或清空，删除前走确认弹层，使用中的由服务端跳过。
### 变更

- **桌面端窗口透明 + macOS 系统材质**：`BrowserWindow` 补 `transparent` 与
  `vibrancy: "under-window"` / `visualEffectState: "followWindow"`，`backgroundColor` 留空避免首帧白闪；
  桌面端的页面自身不再铺不透明底色（`apps/desktop/src/renderer/index.css` 覆盖共享基础层的
  `body { bg-background }`）。玻璃层（外壳 / 侧栏 / 移动端抽屉的 `--glass` + `backdrop-blur`）因此
  真正透出桌面材质；内容卡仍是实色（那是「纸」层，不跟着透）。非 macOS 不做：`transparent`
  在那边要配合无边框窗口，而本壳只在 macOS 走自绘标题条。

- **`ucode.step` 补四个字段并修正 `ttftMs` 口径**：新增 `userTurn`（用户轮序号，由会话池在 run 入口推进——
  `turn` 只是本次装配内的往返序号，会话重装后归零，不能当轮边界）、`provider` / `model` / `stopReason`
  （回答来自哪个模型、以什么原因收尾）；`ttftMs` 改为「响应头 → 首个内容帧」（原先算的是「请求发出 →
  首个内容帧」，与 `firstEventMs` 重叠，四段之和大于总耗时）。按项目约定不回填历史记录，
  老记录缺字段按未知处理、`userTurn` 缺失按 0 归一组。
- …

### 修复

- **终端不再继承宿主的运行环境**：终端进程的环境原先是 `{...process.env}` 全盘继承。除了包管理器注入的标记
  （`npm_execpath` 指向宿主那份 pnpm、`npm_lifecycle_event=start`、`INIT_CWD`）之外，最要命的是
  `NODE_ENV`：生产实例是 `NODE_ENV=production` 起的，而 `vite dev` 拿它而非自己的命令决定模式
  （`isProduction = process.env.NODE_ENV === "production"`），终端里的 `import.meta.env.DEV` 于是为
  `false`，按构建模式选分支的代码（如 dev 态取 CJS interop 的 `default`）走错路，报出
  `opentype.parse is not a function` 这类怪错——同样的命令在系统终端里跑却是好的。现在按前缀剔除
  `npm_*` / `pnpm_config_*` / `APP_*` / `SPIKE_*`，逐个剔除 `PNPM_SCRIPT_SRC_DIR` / `INIT_CWD` /
  `NODE_ENV` / `NODE_PATH` / `NODE_OPTIONS` / `SHLVL`（后三个是启动服务那个运行器给自身注入的
  模块解析路径、选项与 shell 嵌套层级），以及宿主终端的外观标记（`TERM` / `TERMINFO` /
  `TERM_PROGRAM`，TERM 由 node-pty 定为 `xterm-256color`）与 CI 标记；`PNPM_HOME` 这类用户级
  配置保留，用户在 `.zshrc` 里自己 export 的东西由 `zsh -l` 照旧补回。

- **终端失联不再无声卡死**：输出流被判终态时 SDK 不再只回一个 `null`，而是带出是哪一种
  （`exit` / `gone` / `unauthorized`）；终端视图在“终端已不存在”“连接被拒绝”时补一条说明与
  「重新连接」入口。此前这两种情况会让画面冻在最后一帧、不给任何提示，只能刷新页面才发现。

## [0.1.0] - 2026-09-29

### 新增
- …
```

**分节用词**：新增 / 变更 / 修复 / 移除。不用「优化」「调整」这类模糊词，归入最接近的一节。

**版本号**：跟随根 `package.json` 的 `version`。改动流程状态时 bump 并落成 `## [x.y.z] - YYYY-MM-DD`，
未发布的累积改动留在 `## [未发布]`。

**规模上限**：主文件要能一次 `read` 读完（工具是 50KB / 2000 行截断），所以四道线都卡住——未发布 ≤ 40 条、
单个已发布版本的摘要 ≤ 16 条、版本段 ≤ 4 个（未发布 + 最近 3 个已发布版本）、全文 ≤ 45KB。越线的动作
只有一个方向：把内容移出主文件。

- 未发布到 40 条：落版，并按下面的归档规则把明细移走。
- 落版时：主文件只留摘要（≤ 16 条，写「本版做了什么」而不是逐条抄）与一行链接。
- 超 4 个版本段或超 45KB：把最老的已发布版本整段（含摘要）也移进归档，原位置只留链接行。

**归档规则**：明细整体移入 `docs/changelog/<YYYY>.md`（按发布年份，同年合并、版本倒序），
主文件保留「未发布」+ 最近 3 个已发布版本段，更早的只留一行链接。四道上限由
`scripts/verify/checks/changelog.ts` 兜底，越线会让 `pnpm check` 失败。本约定启用前已发布的 `0.2.0` /
`0.1.0` 不回溯搬运——它们是历史段落，原文留在主文件。

## [未发布]

### 新增

- `pnpm check:fast`：中途收窄的校验入口——biome 只查工作区改动的文件 + 全部包 typecheck + 约定校验，
  跳过测试（实测约 11 秒；全量 `pnpm check` 约 22 秒）。不用 biome 自己的 `--changed`：它比的是**已提交**
  的改动（同 `--since` 给的提交点），中途要检查的正是没提交的那些。
- `scripts/verify` 新增 `changelog` 校验项：未发布段的小节名唯一且按 `新增 → 变更 → 修复 → 移除` 排、
  版本号格式与倒序、引用的归档文件存在，以及顶部新写的四道规模上限（未发布 40 条 / 单版摘要 16 条 /
  版本段 4 个 / 全文 45KB）——超限即失败并指明该怎么归档。追加条目时「新开一节」会让同名小节重复，
  攒着不落版又会让主文件长到一次 `read` 读不完，两者都拦在结构上。
- `pnpm verify -- --only <项名>`：只跑指定检查项（如 `--only changelog,i18n`），缺省仍全跑。
- **工作台新增终端**：PTY 由服务进程持有（`node-pty`），工作台的编辑器区以标签形式打开，按**工作目录**归口
  （同目录的会话共用同一批终端）；关标签即结束进程，切会话不结束（进程留在侧栏列表里，重挂会重放最近的输出）。
  契约新增 `terminal` 域（创建 / 列举 / 改尺寸 / 关闭 + 签一次性握手票；输出流是 WebSocket 升级端点
  `GET /terminal/stream`，上行文本=输入、下行二进制=输出，结束与拒绝用关闭码表达），
  服务端新增 `routes/terminal`、`services/terminal`（池、编排、票据同域）与 `constants/terminal.ts`（每目录上限 4 个），
  前端用 `@xterm/xterm` + `@xterm/addon-fit` + `@xterm/addon-attach`（数据面交给官方 addon）+ `@xterm/addon-unicode11`，
  配色由语义 token 采样成 `ITheme`（不新增 ANSI 令牌）。
  终端不落库、不进会话记录、不套 agent 的命令拦截，服务退出时统一清理。
- 外观新增**终端字体**（设置 → 外观）：默认与代码字体同源（`--font-mono-stack`），也可换成 Nerd Font 家族
  ——提示符里的图标字形（私有区码位）只有这些字体才有，系统等宽栈里没有，缺字形会画成方框。
  这些档都是「装了才生效」：选中只把族名接在等宽栈之前（`--font-terminal-base`），没装的人与默认档完全一致。

### 变更

- `AGENTS.md` 的验证与走查口径收紧：「一轮只跑一次」从段落提进验证命令表并补上 `pnpm check:fast`；
  数值微调改用 `agent-browser eval` 读计算值，不截图、不重开页面；`wait` 只用在已确认存在的元素上，
  「操作」与「测量」分两段发，不用 `&&` 绑死。
- `docs/design-surfaces.md` 去掉对组件内部实现的复述（编辑器列表的类名串、`InputSearch` 的内部控制、
  目录条与表格重复的档位）；判据与档位规格保留。
- 浏览器工具集把「不做自动等待」的操作口径写进工具描述里（现在的持久文档见 [`docs/browser.md`](./docs/browser.md)）：`wait` 只用在与已确认
  存在的元素上，操作与测量不串成一条命令。
- **目标栏改成输入卡的上沿一条**：原先它是面板底部通栏的一条带（`border-t` + `bg-muted/40` + 按消息列宽居中的内层），
  现在挂进输入卡、做它的第一个子节点（`rounded-t-lg bg-muted/50` + 下沿分隔线），宽度、居中与圆角都随卡走，
  `Composer` 因此多一个 `topBar` 插槽。顺带统一了这条带子的样式：状态改「圆点 + 文案」，逐轮记录与用量两个行内入口
  改 `ghost` 的 `xs` 档按钮（悬停底色、焦点环、悬停说明走 Tooltip 而不是原生 `title`），暂停 / 恢复 / 清除同档同形；
  窄容器（36rem 以下）里主行只留目标 · 状态与暂停 / 恢复，`⋯` 往上展开一行放逐轮记录、用量与清除，动作文案收起只留图标（`aria-label` 保住可访问名）。
  影响：决策面板打开时它随输入区一起被底衬盖住（原先常驻可暂停），那段时间的目标状态由活动摘要条表达。
- **终端输出流改用 WebSocket**（原 SSE + POST）：两个方向都高频的字节流更适合 WS，且 xterm 生态就长在它上面
  ——数据面直接交给 `@xterm/addon-attach`，服务端只发二进制，客户端不再需要帧解析与 base64 解码。
  握手鉴权用一次性票据（`POST /terminal/ticket` → `?ticket=`）：浏览器 WS 带不了 `Authorization`、凭证也不走
  Cookie，票短时单次且绑定终端，长期凭证仍不进渲染层。判活改由服务端 ping/pong 负责，结束与拒绝走关闭码，
  客户端按码分流（`1000` / `4401` / `4404` 为终态，其余退避重连；取票阶段的 `terminal_not_found` /
  `unauthorized` 同样按终态收场，避免服务重启后残留标签一直重试）。
  握手票在鉴权中间件里**预检**——无效票直接 401，连接不会建立；路由只做核销。
  终端编号由服务端按目录下发（`TerminalInfo.sequence`），关掉中间一个不会让后面的编号前移。桌面端渲染层因此需直连服务端口取 WS
  （`app://` 做不了协议升级），两边 dev 形态的 Vite 代理都开了 `ws` 转发。
  依赖新增 `ws` + `@hono/node-ws`（服务端）与 `@xterm/addon-attach` + `@xterm/addon-unicode11`（前端）。
- SDK 新增终端连接管理（`packages/sdk/src/terminal-socket.ts`）：取票、退避重连、按关闭码判定终态；
  既有的 `reconnect.ts` 仍服务全局事件流，事件流对外行为不变；
  `ui/utils/color.ts` 从 `business/markdown/mermaid` 上提并补上「探针元素求值含 `var()` / `color-mix()` 的表达式」，
  终端主题与 mermaid 共用这一层。
- **安装期补 `node-pty` 的 `spawn-helper` 执行位**：npm 包里的预编译 helper 是 `644`，直接起 PTY 会
  `posix_spawnp failed`。根 `package.json` 新增 `postinstall` 脚本（`scripts/postinstall.mjs`）在安装后补上
  （Windows 无此文件、Linux 自编译产物本来可执行，两者都跳过）；`pnpm-workspace.yaml` 的 `allowBuilds` 放行
  `node-pty` 的安装脚本。依赖新增 `node-pty`（根与 server）与 `@xterm/xterm` / `@xterm/addon-fit`（ui）。

### 修复

### 移除

## [0.3.0] - 2026-10-14

0.2.0 之后的开发累积，共 342 条（新增 88 条 / 变更 196 条 / 修复 46 条 / 移除 12 条），
明细整体归档在 [docs/changelog/2026.md](docs/changelog/2026.md)。主线：

- **插件平台**：契约与宿主内核、登记表与装配、内置与第三方市场、hooks 注入、插件变量与插件 MCP、
  项目级作用域（只做开关）。
- **工作台**：VSCode 式的活动栏 + 侧栏 + 编辑器区、文件树与文件预览、改动与历史、标签条。
- **助手模式与权限**：目标模式收口、三处等用户决策统一成决策面板、只读模式与权限档位口径。
- **外观与设计系统**：设计 token 四层、反色面 token 对、外观参数（字号 / 密度 / 字体）、配色主题机制。
- **会话与上下文**：会话条目登记表与校验、压缩触发点、会话标题并行生成、步级耗时归因与用量统计。
- **平台与工程**：Windows / Linux 纳入目标平台、`@ucode/ui` 按域重排与公开面收口、桌面端改同源、
  `scripts/verify` 的校验项补齐。
- **工程流程**：变更日志改为「发布时明细整体入 `docs/changelog/<年份>.md`，主文件只留摘要与链接」，
  明细不再堆在 `[未发布]` 里。

## [0.2.0] - 2026-09-29

### 新增

- 新增 `packages/contracts`（`@ucode/contracts`）：接口请求校验（zod）、响应类型、统一封套与跨端常量的单一事实源，
  server 与 web 共用同一入口（前端允许引到 zod，不再为隔离它拆子路径）。
- server 新增日志模块 `platform/logger`（pino，开发期 `pino-pretty`）与请求日志中间件 `requestLogger`。
- server 新增 `utils/`（纯函数）与 `constants.ts`（默认值与固定目录名）；新增 `APP_LOG_LEVEL` 环境变量。
- 引入 Biome 作为格式化与 lint 入口（`biome.json`），根脚本新增 `pnpm check`
  （`biome check .` + `pnpm -r typecheck`，作为强制校验入口）与 `pnpm format`。
- 添加 `AGENTS.md`：开发边界、提交流程、注释与编码约定、验证命令、目录约定、生成代码豁免与安全规则。
- 添加本文件。

### 变更

- server 目录：`pi/` 更名 `core/`；`lib/` 收敛为服务端基建（`response` / `validate` / `logger`），
  并与 `routes/` 一样要求一级使用文件夹；路由改为 `routes/<domain>/index.ts`。
- 环境变量统一 `APP_` 前缀：`PI_WORKSPACE_DIR` / `PI_AGENT_DIR` / `PI_DATA_DIR` 合并为主目录 `APP_HOME`
  （工作目录、配置与 `agent/` 全由它派生），`PORT` → `APP_PORT`、`POOL_IDLE_MS` → `APP_POOL_IDLE_MS`、
  `CORS_ORIGIN` → `APP_CORS_ORIGIN`。
- 接口出参统一为 `{ success, code, message, data }`：成功 `code: "ok"`，失败沿用字符串错误码并保留语义化
  HTTP 状态，错误详情放 `data`；请求参数一律进 body。
- `POST /api/v1/messages/send` 重命名为 `POST /api/v1/messages/prompt`。
- `health` 响应字段 `model` 改为 `defaultModel`，与其它接口保持一致。
- `config/info` / `config/update` 不再下发 provider 级 `headers`（可能含鉴权信息），与 `ProviderConfigView` 的声明对齐。
- web 的类型定义与接口封装改为引用 `@ucode/contracts`，删除本地重复定义；`sendMessageStream` 更名 `promptStream`。
- server 响应生产点补齐契约类型的显式标注 / `satisfies`，契约字段变更会直接编译失败（响应体不再停在推断状态）。
- 按 Biome 规则统一现有源码的排版与 import 顺序，清理未使用导入、非空断言与表达式内赋值；
  新增 `@biomejs/biome` 根开发依赖。

### 移除

- 移除 server 内重复的契约定义（`lib/schemas.ts`、`config/schema.ts`）与 `hono/logger`，日志统一走 pino。

## [0.1.0] - 2026-09-29

### 新增

- 初始化 pnpm workspace（`server/` + `apps/web/`），根脚本 `dev` / `build` / `start` / `typecheck` / `smoke`。
- `server/`：Hono + TypeScript，端口 2048，接口前缀 `/api/v1`（`health` 之外全 `POST`）——
  会话列表 / 详情 / 重命名 / 删除、历史、发送（SSE 流式，含 thinking 与 tool call 增量）、中断。
- `server/`：pi SDK 封装——`ModelRuntime` 单例与热重载、`AgentSession` 池（同会话串行 + 空闲回收）、
  复用 pi 的 JSONL 会话持久化；模型 / 端点 / API Key 走运行时配置而非 `.env`。
- `apps/web/`：Vite + React 19 + Tailwind v4 + shadcn/ui 对话界面（会话侧栏、消息流、工具调用卡片、
  模型设置），生产模式由 server 同源托管。
