# 浏览器工具集

面向使用者的说明（怎么配、边界在哪）与实现口径的单一出处。方案原文（飞书文档《Pi Browser 扩展方案》的落地版）
已随实现删除，本文是它的持久化结果。

## 是什么

给 agent 一组浏览器工具，用来**自证前端改动**：打开页面、拿到带编号的元素列表、点 / 填 / 按 / 选 / 滚、截图、关闭。
两条传输，同一套语义：默认是服务进程内的 Playwright（headless）自己起受管实例；桌面端开着浏览器标签时，
驱动的就是那个标签（见下），画面本身就是证据。

桌面端另有**内置浏览器面板**（仅桌面端，web 端没有）：工作台里的一个标签承载 Electron 的 `<webview>`，
带地址栏、前进 / 后退、刷新与开发者工具，多个标签共用一份数据（`persist:<slug>-browser`）。

桌面端与服务的**通道**接在 `GET /api/v1/browser/desktop`（WebSocket，票在 `POST /api/v1/browser/desktop/ticket`）：
桌面端把「开了哪些标签、当前在看哪一个」报上来，服务端把 CDP 命令发下去。**agent 驱动的就是那个页面**——
你在看哪个标签它就动哪个（同一个地址栏、同一份 cookie），所以「它做了什么」不用靠推流复现，画面本身就是证据。
驱动走自研的薄 CDP 客户端而不是 Playwright：`<webview>` 的 CDP 入口在 `webContents.debugger`，而
`connectOverCDP` 只认 `type: "page"` 的目标（guest 的目标类型是 `webview`，会被它静默丢掉）。

驱动面的四条口径：

- **目标是「当前激活的那个标签」**：切标签即换目标（编号表跟着作废，下一次操作会明确报编号失效）；标签关了就是
  「桌面端没有开着浏览器标签」，不会偷偷换成受管实例；
- **`browser_open` 导航的是它**（不另起窗口、不动别的标签）；**`browser_close` 只断开**，标签留给你继续用；
- **想强制用受管实例**：在 `browser_open` 里传 `profile` / `cdpEndpoint`（或 `headless` / `executablePath`）。
  配置里的默认 profile 不算「显式」——它是「如果要用受管实例就用这份数据」；
- **桌面端只驱动自己创建的标签**：命令里的 `webContentsId` 必须在本应用 `did-attach-webview` 登记过的集合里，
  否则拒回——不然一句 `webContentsId` 就能驱动应用界面本身。

### 元素选择（桌面端面板）

面板工具条的「元素选择」进点选模式：页面上悬停高亮、点一个元素即把它**加进当前会话的输入框**——输入框里是
一枚**芯片**（元素的可访问名，悬停给选择器与页面），随消息一起发给模型的是下面那张表里的**完整摘要**；
`Esc` 或切换标签取消。它进的是**用户自己的消息**，所以模型按用户内容看待，
与工具返回的外部内容不是一回事。

摘要按「模型能不能定位到源码里的那个元素」来取舍，字段与同类产品（Trae 起的头、Cursor 的 Design Mode、
ZCode 的网页元素上下文）基本对齐：

| 字段 | 内容与上限 |
| --- | --- |
| 页面 | 标题（空则「(无标题)」）与地址 |
| 元素 | `role` 与可访问名（80 字符）+ 标签 |
| 选择器 | 优先测试 id（`data-testid`/`data-test`）→ `#id` → `[name]` → `[aria-label]` → 带 class 与 `nth-of-type` 的结构路径（300 字符）；前三种在仓库里能直接搜到，比纯路径有用 |
| 位置 | 视口坐标与尺寸（取整） |
| 样式 | 颜色 / 背景 / 字体（字号+字体族）/ 字重 / `display`，空的（如透明背景）与默认值不写 |
| 属性 | `k="v"` 一行，最多 24 个、单值 160 字符、整行 300 字符；**剔除内联事件与 `style`** |
| 文本 | 元素自身文本（200 字符），与可访问名相同就不重复写 |
| 附近 | 父元素里除它以外的文本（160 字符）——列表项 / 表格行靠它说清是「哪一条」 |
| HTML 片段 | `outerHTML`，1500 字符，剔除内联事件与 `<script>`/`<style>` |

空值整行不写（半行空标签只占上下文）。**不做**：组件名与 fiber props（Cursor 有，需要构建期插件）、元素截图
（他们随选中项再带一张图）、多选与画框——这三样的代价都在别的层，不在字段本身。

采集脚本注入页面主世界（`<webview>.executeJavaScript`）执行，返回的 Promise 就是结果本身——这条通道与
agent 驱动那条 CDP 通道**互不相干**：不驱动也能自己选元素。

| 工具 | 作用 |
| --- | --- |
| `browser_open` | 打开 http/https 地址（或 attach 到你已启动的调试实例）；带 `profile` 名即长期保留这份数据 |
| `browser_snapshot` | 当前页面的元素列表，每行 `@e1a2 button "登录"`；可选 `diff`（只回传变化）与 `compact`（取噪） |
| `browser_act` | 对 `@e` 编号元素执行 click / fill / type / press / select / scroll，或用 `eval` 求值一段表达式 |
| `browser_screenshot` | 整页或某个元素的 jpeg（作为 image 结果交回模型） |
| `browser_close` | 关掉自己启动的实例；attach 模式只断开，不动你的浏览器 |

三条刻意的「不智能」：**不做自动重试、不做自动等待、失败立刻返回原因与下一步**。元素被遮挡或编号失效时
不会硬等到超时——遮挡用中心点命中检测（被遮罩盖住的元素在 DOM 里仍「可见」，`isVisible()` 判不出来），
实测 1ms 级失败并报出遮挡者。

`eval` 在页面上下文求值一段表达式并把结果带回来，用来读快照看不见的东西——最典型是计算值
（`getComputedStyle` 的高度 / 间距 / 字号，这类「比数字」的场景截图比不了）。服务端把表达式固定包成
`(() => (…))()`，两条传输拿到的是同一个字符串，所以两边行为一致；也因此**多语句要自己写成 IIFE**
（`(() => { const s = getComputedStyle(document.querySelector(".x")); return { h: s.height }; })()`）。
结果转成文本：字符串原样、其余紧凑 JSON，上限 4000 字符（超了截断并注明原长度）；表达式没有返回值、
或返回 DOM 节点这类序列化不了的值，当场报错并说清该怎么写，不递一个空结果让人猜。

## 编号与快照语义

- 编号按 `role + 可访问名`（同名再带序号）哈希生成，**不是递增序号**：页面多出弹层 / toast 时已有编号不错位。
- **导航后编号整体失效**，强制重新快照；**SPA 路由（`pushState`）不算导航**——地址变了而文档没换，
  编号继续有效（判定看文档的 `performance.timeOrigin`，不看 URL）。
- 采集范围：`a[href]` / `button` / `input`（非 hidden）/ `select` / `textarea` / `summary` / `h1`–`h3` /
  `[role]` / `[contenteditable]` / `[tabindex]`。因此 `role="status"` 这类语义状态文本也在列表里（对验证有用）。
- 名字取可访问名：`aria-label` → `aria-labelledby` → `<label>` 文本（**只取控件之外的那部分**，否则
  `<label>城市 <select>…</select></label>` 会把全部选项文本算进来）→ placeholder / alt / title / name → 自身文本。
- 列表有字符数上限与元素数上限，截断时末尾写明总共有多少；`compact` 额外丢掉无名通用容器与视口外元素。

## 数据与 profile

- 数据落在 `$APP_HOME/app/browser/profiles/<name>`，**权限 0700**（里面有 cookie 与 localStorage，属凭证面）。
- 名义规则：单段、小写字母或数字开头（`^[a-z0-9][a-z0-9._-]{0,63}$`），拼路径前校验，挡路径穿越。
- `browser_open` **给了 profile 名就长期保留**（登录态跨会话在），不传则用临时目录、实例关掉即删。
- 实例按 profile 名共享（引用计数 + 空闲回收 + 份数上限），同一 profile 不能被两种数据目录同时打开。
- 设置页「浏览器」分节可以看连接方式、默认 profile，以及每份数据的占用与最后使用时间，并删除 / 清空；
  使用中的那份会被跳过（删到一半会把实例正打开着的文件抽走）。

## 安全边界

- **只读模式（plan / ask）放行观察面、页面操作看实例**：`browser_open` / `browser_snapshot` /
  `browser_screenshot` / `browser_close` 是观察面（打开页面、看元素、截图、断开），只读模式下照常可用——
  四个都按默认规则放行（没有单独的审批规则）。`browser_act`（点击 / 输入 / 滚动 / 表达式求值）只在
  **受管实例**（我们自启的 Chromium，`mode === "isolated"`）里放行：attach 连的是你自己的调试实例、
  desktop 驱动的是桌面端面板里你正看着的标签，那两种下仍阻断。哪几个算观察面写在
  `harness/features/browser/tools.ts` 的 `BROWSER_OBSERVE_TOOL_NAMES`，新增的浏览器工具默认落在阻断侧。
  白名单会话（explore 之类）干脆不注册这组工具。
- **只有受管实例算隔离，但「受管」不等于「数据隔离」**：不传 `profile` 时它用临时数据目录，与你的浏览器完全分开；
  传了 `profile`（或设置页里配了默认 profile——`browser_open` 每次都会把它带上去）就是长期保留的那一份数据
  （含登录态），在它上面点按钮等于以你的身份操作该站点。计划 / 问答模式对 `browser_act` 的放行只看
  「实例是我们起的」，所以介意这点就别给这些会话留默认 profile，或切到编码模式动手。
- **不做站点级审批**：`browser_open` 与 `bash` / `webfetch` / `websearch` 同档默认放行——单独给浏览器加确认不成立
  （那几个的外联面更宽）。真正的凭证面是带持久 profile 打开站点：那次操作等于以你的身份访问该站。
- **回环与私网允许**（本地自测是主要用途），**`file://` 与 `data:` 一律拒绝**——要读本地文件用 `read` 工具。
- **不主动打开你默认 profile 的浏览器**：attach 只连你自己启动的调试实例；Chrome 136 起默认 user-data-dir 上
  的 `--remote-debugging-port` 会被忽略，必须配非默认的 `--user-data-dir`。术语与档位见
  [`modes-and-permissions.md`](./modes-and-permissions.md)。

## 已知限制

| 限制 | 说明 |
| --- | --- |
| iframe / closed Shadow DOM | 快照只覆盖主 frame；`getByRole` 穿不透 closed shadow 根 |
| 虚拟滚动列表 | 不在 DOM 里的元素取不到编号，先 `scroll` 再快照 |
| 文件上传 / 多标签页 | 未实现（动作集里没有，也不接管已有标签） |
| 用户接管 | 不做：档位 1（可见视图）与档位 4（接管）会牵扯「人工与 agent 并发操作」的一整套状态机 |
| 多标签 | agent 只驱动**当前激活**的标签：想让它看另一个页面，自己在桌面端切过去（刻意的，见「目标是当前激活的那个标签」） |
| 元素选择的深度 | 不给组件名 / fiber props（要构建期插件）、不带元素截图、不支持多选与画框：只给「照着改」够用的那一组字段 |
| 桌面端只在本机 | 通道是「桌面端连服务端」的一条本机 WS，不对外开放 |
| 不是插件 | 这组能力是内置功能，插件平台只承载资源与受信任的代码扩展，见 [`plugins.md`](./plugins.md) |

## 与 agent-browser 的对拍（步骤 9 的结论）

脚本 `pnpm -F @ucode/server browser:parity`：同一批本地页面两边各取一次快照比元素覆盖，再跑同一串动作比
可观察结果（报告写 `.tmp/browser-parity-report.md`）。编号算法本就是自主选择，不对拍。

- **动作语义全部一致**：fill + click、select、check、同名元素点击、动态插入，以及**遮挡**
  （两边都不点穿：我们 `element_obstructed`、agent-browser 报出遮挡者）。
- 覆盖差异只剩两条且都解释得清：我们额外编号 `status` 之类的语义节点（对验证有用）；他们额外列 `option` 节点
  （我们不单独编号，`select` 动作直接吃 value 或可见文本）。
- 对拍修掉两处真实问题：标题（`h1`–`h3`）原先漏采集，已补；`<label>` 里嵌 `<select>` 时的名字原先把选项
  文本也算进来（`combobox "城市 北京上海"`），现在只取控件之外的文本。

## 验证

| 命令 | 覆盖 |
| --- | --- |
| `pnpm check` | 类型 + 单测（`server/src/harness/features/browser/__tests__`、`services/browser/__tests__`）+ 约定校验 |
| `pnpm -F @ucode/server browser:smoke` | 真浏览器端到端：open / snapshot / fill+click / eval / 遮挡失败 / 截图 / 导航失效 / 临时与持久化 profile / close |
| `pnpm -F @ucode/server browser:parity` | 与 agent-browser 的对拍（需要本机装了 `agent-browser`） |
| `pnpm -F @ucode/server browser:desktop-smoke` | 桌面端**驱动**的端到端冒烟：本进程起服务与本地页 → 起桌面端并在面板里打开该页 → 直接调动作面跑 snapshot / click / screenshot / open，以及**元素选择**（面板进点选模式后用 CDP 真点一下，断言摘要进了输入框）；断言是跨进程可见的（点击后页面标题经桌面端读回变成「已点击」）。**需要先 `pnpm -F @ucode/desktop build`** |
| `pnpm -F @ucode/desktop browser:smoke` | 桌面端浏览器面板的端到端冒烟：活动栏入口 / 新标签开出 webview / 地址栏导航 / 多标签常驻 / 切标签不丢页面，以及**注册通道**（服务端看到两个标签、激活项正确、带上 `webContentsId`）。**需要先 `pnpm -F @ucode/desktop build`**（产物过期时脚本自己会报错），所以不进 `pnpm test` |
