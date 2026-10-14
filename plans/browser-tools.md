# 浏览器工具集（服务进程内 Playwright + screencast 可视化）

> 状态：**方案定稿，未实施**。素材来源：飞书文档《Pi Browser 扩展方案》（在 Pi harness 上复刻
> agent-browser，叠加优化层与可视化层）。
>
> 本项目此前那份桌面端 `WebContentsView` 的旧方案已废弃删除，**不作参考**。
>
> 五个已定前提：
>
> 1. **形态 = 内置功能**（`harness/features/browser` + 内联扩展工厂），不做随包插件包——理由见第二章；
> 2. **浏览器由服务进程内的 Playwright 持有**（headless），不由桌面端视图层持有；
> 3. **从零实现**（源文档 §13 提到的「已实现、26 项测试通过」那份代码不在本仓库）；
> 4. **可视化一起做**：服务端 CDP screencast → 新增帧通道 → 工作台浏览器面板（源文档档位 2）；
> 5. **浏览器身份可配**：默认我们自己的隔离实例（临时数据），可选 attach 到用户自己启动的调试端点；
>    隔离数据可按命名 profile 长期保留，并在设置页里管理（第五章）。

引用写成「路径:行号」，行号随代码演进会漂移，**以符号名为准**。

## 一、目标与非目标

**目标**：模型能开页、拿到带编号的元素表、点 / 填 / 按 / 选 / 滚、截图、关闭——用它自己验证前端改动。

**非目标**：用户接管（源文档档位 4）、档位 1 的可见视图、多标签页、文件上传、下载管理、
iframe / closed Shadow DOM / 虚拟滚动列表的完整支持、移动端模拟、web 端独立浏览器，
「用户自己在应用内浏览网页」那个面板（它要桌面端视图层，与本文的能力层无关），
以及**主动打开用户默认 profile 的浏览器实例**（第五章 5.1 说明了为什么）。

## 二、为什么不做成插件包

四条依据，都不是偏好问题：

1. **依赖解析过不去**。插件 `extensions/` 是 pi 的 jiti 在运行期按 Node 规则**相对扩展文件**解析依赖
   （只 alias 了 `@earendil-works/*` 与 `typebox`，`pi/dist/core/extensions/loader.js:42-84`）。
   插件装在 `$APP_HOME/plugins/cache/...` 时 `import "playwright-core"` 找不到仓库根 `node_modules`；
   要解决就得把插件包放进仓库树内，或把依赖装进插件目录。
2. **「随包插件包」没有落点**。`harness/plugins/builtin/index.ts:14-27` 的 `BuiltinAsset` 只有
   `kind: "prompt" | "skill"`，`materialize.ts` 只物化技能；`harness/plugins/registry.ts` 的
   「发现只认登记表」要求先补一段 seed + 登记机器，而 `harness/plugins/state.ts:47-70` 已把「随包插件包」
   这一形态作废（官方市场改成 git 仓，走那边就要联网）。
3. **权限与只读门控要靠服务端清单**。只读模式（plan / ask）的判定是
   `harness/setup/agents/capability.ts:92` 用 `WRITE_TOOLS`（`harness/setup/tools/names.ts:66`）整批 deny
   推出来的。扩展注册的工具名不进这份清单，plan / ask 会话就会拿到浏览器工具（后果 = 任意导航 +
   可能读本地文件）。走内置功能时这套门控在同一处收口。
4. **可视化层超出插件能力面**。插件平台明确不提供界面贡献与界面插槽；
   而 screencast 的目的地是界面。源文档第 2 档要的是一块渲染面板 + 一条帧通道，只能做内置功能。

## 三、能力层（`server/src/harness/features/browser/`）

```
detect.ts     浏览器探测（6 级优先级，结果按进程缓存）
session.ts    按 profile 持有的 BrowserSession（launch / connect 双模式、懒启动、引用计数、释放）
snapshot.ts   aria 快照 + @eN 编号表（纯函数部分可单测）
actions.ts    动作集（click / fill / type / press / select / scroll）
errors.ts     统一错误模型（code + hint + staleRefs）
screencast.ts CDP 推流（见第七章）
profiles.ts   profile 目录的列举 / 占用统计 / 删除（第五章 5.3）
registry.ts   profile → BrowserSession 的注册表（供会话池释放、使用中保护）
index.ts      createBrowserExtension()：pi.registerTool × N
```

与 `features/shell` 同范式：`index.ts` 导出扩展工厂，由 `harness/setup/session-config.ts:226` 的
`extensionFactories` 调用（shell 的对应写法见 `harness/features/shell/index.ts:40`）。

### 3.1 工具集

5 个工具（源文档的 4 个 + 截图）。加 `browser_screenshot` 的理由：headless 下模型看不到像素，
「视觉结果对不对」只能靠截图；而 pi 的工具结果本身就支持 `ImageContent`
（`pi/dist/core/extensions/types.d.ts:728`），截图可以直接作为 image block 交回模型，
不需要任何附件上传链路。

| 工具 | 入参（typebox `Type.Object`） | 返回 |
| --- | --- | --- |
| `browser_open` | `url`、可选 `profile` / `cdpEndpoint` / `executablePath` / `headless` | 标题 + 最终 URL |
| `browser_snapshot` | 可选 `diff`（差量回传，见第八章） | aria + `@eN` 列表；超上限时截断并写明 |
| `browser_act` | `action`：`click` / `fill` / `type` / `press` / `select` / `scroll`，加 `ref` / `text` / `key` / 方向与距离 | 动作结果摘要（含导航后的新 URL） |
| `browser_screenshot` | 可选 `fullPage` / `ref` | `ImageContent` |
| `browser_close` | — | launch 模式关进程、connect 模式**只断开**（源文档 §8 坑 1） |

三个入参覆盖配置项（`profile` / `cdpEndpoint` / `executablePath`），缺省取配置里的值（第五章 5.1）。

声明口径：`executionMode: "sequential"`（浏览器状态是共享可变状态，`pi/dist/core/extensions/types.d.ts:490`）；
`annotations` 给 `openWorldHint: true`、`browser_act` 给 `destructiveHint: true`——但**不能只靠它**：
本仓库的权限引擎不吃 annotations（只有 MCP 那条路读，`harness/setup/permissions/mcp-rules.ts:20`），
必给的规则见第四章。

### 3.2 五个关键设计点（照源文档 §6，不加「智能」）

1. **ref 编号跨刷新稳定**：编号基于 `role + accessible name` 的归一化哈希，不是递增序号；
   同一页面 fingerprint 下复用编号表，弹层 / toast 出现时已有元素不错位。
2. **失败必须给 hint**：错误模型带 `code` / `hint` / `staleRefs`；`staleRefs: true` 是给模型的信号位——
   它看到就知道要重新 `browser_snapshot`，而不是重试同一个 ref。
3. **遮挡用中心点命中检测**：取元素中心坐标 + `elementFromPoint`，命中的不是它自己就**立即失败**
   并指出被谁挡住。`isVisible()` 在这个场景无效（被遮罩盖住的元素在 DOM 里仍「可见」）——
   源文档实测：从「等 8 秒超时」变成「11 毫秒快速失败」。
4. **导航后清空 refs**：`framenavigated` 即清空编号表，强制模型重新快照。
5. **不做自动重试 / 自动等待**：源文档 §3 明确「agent-browser 的『笨』是特性」。这条要写进工具描述与
   提示词，否则模型会以为工具会自己等。工具描述里同时写清**等不到时的代价**（按已踩过的坑）：
   `wait` 只用在已确认存在的元素上（元素在不在先由 `snapshot` 或 `act` 的失败 hint 确认），
   拿猜出来的选择器去等只会等到超时，还把同一条命令里前面已执行的步骤一起作废；
   「操作」与「测量」（读计算值）分两段发，别把它们串进同一条命令——测量失败不该让操作从头再来。

### 3.3 浏览器探测（`detect.ts`）

优先级照源文档 §7：`CHROME_PATH` / `EDGE_PATH` 等显式环境变量 → 各平台标准安装路径 → `PATH` 查找 →
`~/.cache/ms-playwright` → `~/.cache/puppeteer` → 都没有则**明确报错并列出试过的路径**。
覆盖 Chrome（稳定 / Beta / Dev / Canary）、Edge、Chromium、Brave；Windows 的
`Program Files` 与 `Program Files (x86)`、`LOCALAPPDATA`、Edge 的
`Program Files (x86)\Microsoft\Edge\Application` 三个变体要一次写全（源文档建议照 Puppeteer 的
`browser-fetcher` 枚举）。

**依赖用 `playwright-core`（不是 `playwright`）**：前者不带内核下载脚本，探测不到就报错 + 给安装提示，
不静默往 `~/.cache/ms-playwright` 下几百 MB。两个 `package.json` 同步声明同版本
（根 `package.json:26-39` 与 `server/package.json:14-28`），`scripts/verify/checks/manifest.ts:26-40` 会校验；
构建侧不用改——`scripts/build-cli.mjs:19-27` 已经把第三方包一律 external，运行期从仓库根 `node_modules` 解析。

### 3.4 会话与生命周期

- **实例按 profile 持有**（第五章 5.2）：一个 profile 一份 `BrowserSession`，会话只是引用者；
  懒启动——首次用某个 profile 才 launch。**不共享浏览器进程**（profile 之间 cookie / 存储天然隔离），
  代价是内存。
- **释放**：引用计数归零后不再立即关，交给空闲 TTL；接进会话池的销毁路径——
  `core/pool.ts:1135` 的 `dispose()` 与 `:1170` 的 `disposeAll()`（会话回收、revision 重建、
  进程退出都会走到），同时挂一个幂等的 `session_shutdown` 兜底
  （pi 的生命周期约定见 `pi/docs/extensions.md`「Respect the runtime lifecycle」）。
- **上限**：空闲 TTL、profile 数与会话并发上限见第四章的常量表；超限时工具直接失败并说明原因，不排队。
- **不假设单例**：一个进程多会话、多窗口多实例（SDK 无单例），注册表按 profile 分键。

### 3.5 错误模型

`errors.ts` 统一成「为什么 + 怎么办」，工具失败用 `throw`（pi 转成失败结果，`pi/docs/extensions.md`「Tools」）：

| code | 场景 | hint |
| --- | --- | --- |
| `browser_not_installed` | 探测不到任何浏览器 | 列出试过的路径 + 安装建议 |
| `browser_not_open` | 未 `browser_open` 就操作 | 先调 `browser_open` |
| `ref_not_found` / `stale_ref` | ref 不在编号表 / 元素已脱离 DOM | `staleRefs: true` → 重新 `browser_snapshot` |
| `element_obstructed` | 中心点命中别的元素 | 报出遮挡者的 role + name |
| `navigation_failed` | 站点错误 / DNS / 超时 | 给 URL 与失败原因，不重试 |
| `blocked_target` | 目标被准入策略拒绝 | 说明策略（见第六章） |
| `attach_failed` | attach 模式端点连不上 / 不是浏览器级端点 | 给端点与排查建议（实例还活着吗、端口对不对） |

工具结果超上限时**头截断不可接受**：快照是整段结构化文本，改成写临时文件 + 在结果里给路径
（照 pi 的 truncated-tool 做法）。

## 四、与仓库的接入点

| # | 落点 | 改什么 |
| --- | --- | --- |
| 1 | `harness/setup/tools/names.ts` | 新增 `BROWSER_TOOL_NAMES`；并入 `WRITE_TOOLS`（只读模式整批 deny）；加进 `KNOWN_TOOL_NAMES`（否则自定义角色声明这些工具名会被判非法，`agents/custom.ts:326` 那条校验）；**不动** `EXEC_TOOL_NAMES`——它的语义是「命令执行」，`isExecTool` 只用于只读规则文案 |
| 2 | `harness/setup/agents/profiles.ts:33` | `READ_ONLY_PERMISSIONS` 的 note 现在按 `isExecTool` 二选一（「不允许执行命令 / 不允许改文件」），浏览器要第三类文案 |
| 3 | `harness/setup/permissions/engine.ts:93` | `toolTarget` 补 browser 分支（**subject 取 host**，不是 ref）；默认规则见第六章 |
| 4 | `harness/setup/session-config.ts:226` | `extensionFactories` 加 `createBrowserExtension({...})`。**门控口径：照旧注册、靠规则 deny**——只读模式「不换工具表」是既定设计（`docs/modes-and-permissions.md:34-41` 的理由是切工具表会被 pi 回放成突变），所以不要按模式决定注不注册 |
| 5 | `harness/setup/prompt/locales/zh-CN.ts:56` | `toolPolicy` 补浏览器分节（先 snapshot 再 act、ref 用完即弃、失败看 `staleRefs`、headless 下用截图确认视觉）。默认提示词源是 `custom`，pi 的 `<tools>` 段（`promptSnippet`）**不生效**，不补文案模型只能从 JSON Schema 猜 |
| 6 | `packages/contracts/src/config/{input,output}.ts` + `routes/config/index.ts` | `browser` 块（`mode` / `endpoint` / `profile`）+ `BrowserView`，走既有 `POST /api/v1/config/update` 合并链 |
| 7 | `packages/contracts/src/browser/{input,output}.ts` + `scripts/api-docs/endpoints.ts` | profile 管理三接口 + 帧流入参；登记后 `pnpm api:docs` 重生成 |
| 8 | `packages/ui/src/utils/settings-section.ts` + `business/settings/{settings-sections.tsx,settings-panel.tsx}` | 新增「浏览器」分节（第五章 5.3） |
| 9 | `docs/modes-and-permissions.md` | 补「浏览器属执行类：只读模式 deny、默认档位 ask、subject 取 host；attach 不放宽任何门控」 |
| 10 | `CHANGELOG.md` | 未发布段（新增工具、新依赖、新配置项、新接口、新设置分节） |
| 11 | 根与 `server/package.json` | `playwright-core` 同版本 |

界面侧的工具渲染无需改也能跑：工具名没有契约枚举，未登记的工具名走兜底渲染
（`packages/ui/src/business/chat/tool/tool-view.ts:33` → `other`，Wrench 图标 + JSON 参数块）。
要给浏览器工具专门展示（比如把 ref 列表渲染成可点列表）再加映射，属后续增强。

### 4.1 常量与默认值（`server/src/constants/browser.ts` + `constants/dirs.ts`）

这些值集中一处，改行为只改这里；括号里是建议默认值：

| 常量 | 建议值 | 说明 |
| --- | --- | --- |
| `BROWSER_IDLE_TTL_MS` | 10 分钟 | profile 空闲多久自动关实例 |
| `BROWSER_MAX_SESSIONS` | 3 | 同时运行的实例数上限，超限即失败 |
| `BROWSER_MAX_PROFILES` | 10 | 命名 profile 数上限，防设置页被垃圾目录塞满 |
| `BROWSER_PROFILE_MAX_BYTES` | 2 GiB | 单份 profile 的占用上限，超限即失败并提示清理 |
| `BROWSER_PROFILE_SCAN_MAX_FILES` | 20 000 | 统计占用时的遍历上限，超限就不给精确值（照 `PLUGIN_HASH_MAX_*` 的先例） |
| `BROWSER_SNAPSHOT_MAX_CHARS` | 落地时按实测定 | 超过即落临时文件 + 结果里给路径 |
| `BROWSER_LAUNCH_TIMEOUT_MS` | 30 秒 | launch / attach 与首次导航的上限 |
| `BROWSER_ACTION_TIMEOUT_MS` | 10 秒 | 单个动作的上限（不做自动等待，超时即失败） |
| `BROWSER_NAVIGATION_TIMEOUT_MS` | 30 秒 | 页面加载上限 |
| `BROWSER_SCREENCAST_FPS` | 8 | 帧率节流上限（CDP 不限速，必须自己丢帧） |
| `BROWSER_SCREENCAST_QUALITY` | 60 | jpeg 画质 |
| `BROWSER_SCREENCAST_MAX_WIDTH` | 1280 | 帧宽上限，订阅者上报的更小时取更小值 |
| `BROWSER_DIRNAME` | `browser` | `$APP_HOME/app/browser/`，其中 `profiles/<name>` 是各份持久化数据 |
| `OWNER_ONLY_DIR_MODE` | `0o700` | profile 目录权限（现有 `OWNER_ONLY_MODE` 是文件的 0600，目录要单独一个） |

## 五、浏览器身份与数据

三件事正交：**连谁**（isolated / attach）、**数据存哪**（临时 / 命名 profile）、**谁在用**（哪些会话引用它）。

### 5.1 连接方式

| 模式 | 行为 | 默认 |
| --- | --- | --- |
| `isolated` | 我们自己 launch 受管实例（用探测到的系统浏览器）；生命周期归我们，关掉即回收 | ✅ |
| `attach` | `connectOverCDP(endpoint)` 连**用户自己启动的**实例；`browser_close` 只断开（源文档 §8 坑 1），我们既不启动也不关它的进程，也不碰它的数据目录 | 关 |

- 配置落 `$APP_HOME/app/config.json` 的 `browser` 块（`mode` / `endpoint` / `profile`），契约在
  `packages/contracts/src/config/{input,output}.ts`，走 `POST /api/v1/config/update`；
  `browser_open` 的三个入参（`profile` / `cdpEndpoint` / `executablePath`）可覆盖单次行为。
- **我们不主动打开用户默认 profile 目录**。平台事实（外部资料，落地前再核）：Chrome ≥136 在默认
  user-data-dir 上会忽略 `--remote-debugging-port` / `--remote-debugging-pipe`，必须配非默认的
  `--user-data-dir`，Chrome for Testing 不受影响（[Chrome for Developers 公告](https://developer.chrome.com/blog/remote-debugging-port)）。
  所以「带上真实登录态」这件事由用户自己负责：他用哪个 profile 目录启动带调试端口的实例，
  我们只连那个端点。这样做同时避开两个坑——两个实例抢同一份 profile，以及 agent 写入用户真实
  cookie / 自动填充 / 已登录站点。Chrome 144 起还有一个「内置远程调试请求 API（界面授权）」的形态，
  官方文档核实之后再评估要不要接；**不按博客级材料实现**。
- attach 的接管语义：`connectOverCDP` 拿到的是 browser 级对象，里面可能已有多个 context / page。
  口径：**只操作我们新建的 page**，不接管用户已有的页面（避免「agent 动了用户正在看的标签」）；
  编号表按 page 分键，`browser_close` 只解自己的 page。端点连不上或不是 browser 级端点报 `attach_failed`。
- 同一端点天然只有一个实例，多会话 attach 就是共享那份状态——这是用户选的模式，不做额外隔离。

### 5.2 数据目录与长期保留

- **临时（默认）**：`chromium.launch()` 的临时 user-data-dir，实例关掉即删，不碰用户任何数据，
  也不留任何东西。
- **持久化**：`chromium.launchPersistentContext(<$APP_HOME>/app/browser/profiles/<name>)`，
  跨会话长期保留（登录态、localStorage 都在里面）。目录落 `app/` 下，与 attachment / memory / builtin 同层。
- **粒度是按 profile 名**（不是按会话）：`browser_open` 的 `profile` 入参缺省取配置里的默认名。
  多会话共用一个 profile = 会话间的浏览器隔离不再成立（互相看得见 cookie），这是用户显式选择，
  文档与设置页要写明。
- **权限**：profile 里有 cookie / localStorage / IndexedDB，属凭证面 → 目录 0700
  （`platform/file-permissions` 现在只有文件的 `OWNER_ONLY_MODE = 0o600`，要补目录模式常量）。
- **体积**：单份与份数都设上限（4.1 的表）；统计占用走目录遍历，超上限就报「无法精确统计」，
  不让设置页卡住。

### 5.3 设置页「浏览器」分节与数据管理

设置页新增一个分节（`utils/settings-section.ts` 的 `SettingsSectionId` + `settings-sections.tsx`
元数据 + `settings-panel.tsx` 分节 + 一个表单组件 + i18n），两块内容：

- **连接**：模式（isolated / attach）、端点、默认 profile 名。选 attach 时把风险写在界面上
  （「agent 将能操作该实例里已登录的站点，请只连你愿意交给它的实例」）。
- **数据**：profile 列表（名称 / 占用大小 / 最后使用时间 / 是否使用中）、删除单份、清空全部。
  删除要**使用中保护**：有会话正握着该 profile 时拒绝并说明（或先关实例再删），
  不能删到一半把实例的文件抽走。

服务端接口（动作词要在 `docs/api.md` 的封闭词表内）：

| 接口 | 作用 |
| --- | --- |
| `browser/profiles` | 列出 profile：名称、字节数（超遍历上限则标记不精确）、最后使用时间、是否使用中 |
| `browser/delete` | 删单份；使用中即拒绝（错误码走既有 `invalidRequest` 语义 + 明确文案，或新增一个码） |
| `browser/clear` | 清空全部（使用中的排除并说明） |

做不到的：Chrome 不提供「按站点看 / 清」的视角，所以只做整份 profile 的增删，站点级清理不做。

## 六、安全边界

- **只读模式一律 deny**：浏览器能起进程、能出网、能读 `file://`，与 `bash` 同档。plan / ask 下
  `browser_*` 全部被规则挡住（靠第四章第 1 条的 `WRITE_TOOLS`），档位（`default` / `auto` / `full`）
  只能放宽 `ask`、永远不能突破 `deny`（`docs/modes-and-permissions.md:130-146`）。
- **attach 不放宽任何门控**：配置里打开 attach 只决定「能不能连上一个用户给的端点」，
  不是授权——只读模式照样 deny `browser_*`，`browser_open` 的 host 审批照旧。
- **回环与私网要允许**：这个工具最主要的用例就是让模型验证自己刚改的前端，而 dev server 通常就在
  `http://127.0.0.1:<port>`。若照 `webfetch` 那样一律拒绝私网（`harness/setup/tools/ssrf.ts` 的
  `assertPublicUrl`），核心用例直接没了。代价是 `browser_open` 默认 `ask`，审批对象是 host，
  用户看得见自己批了什么。**`file://` 默认 deny**（本机任意文件读取面太大），要读本地文件用 `read` 工具。
- **审批粒度**：`browser_open` 默认 `ask`（subject = host，可「本会话恒允该 host」）；
  `browser_snapshot` / `browser_screenshot` / `browser_close` 默认 `allow`；
  `browser_act` 默认 `allow`（它作用在已批准的页面上）。
  **不做**「页面内跳转到新 host 时逐跳审批」：那要靠导航事件里再挂一次审批，而工具执行中途挂起会让
  交互状态复杂化（`core/interactions.ts:57` 的挂起是会话级、面向用户的）。折中：`framenavigated`
  到未批准 host 时，把「当前页面已离开批准范围」写进工具结果提示模型，并在该会话的下一轮
  `browser_open` 重新走审批。
- **profile 目录是凭证面**：里面有登录态与站点数据，目录 0700、按 `$APP_HOME` 的既有口径管理，
  不额外暴露读取接口（只给「删除」）。
- **不给 UCode 自己的 Electron 应用开 CDP**（源文档 §8「方式 A：整个 app 开 `remote-debugging-port`」）。
  桌面端 `defaultSession` 上挂着 `/api/*` 的 `Bearer` 注入
  （`apps/desktop/src/main/index.ts:38-46`、`apps/desktop/src/main/proxy.ts:46-58`），
  让模型通过 CDP 驱动自己的窗口等于把带凭证的同源会话交给它。这条路不做；
  将来要做得限定在独立 partition 上新建的实例。
- **资源上限**：见第 3.4 节与 4.1 的常量表；模型侧只看得到失败原因，看不到进程细节。

## 七、可视化层（screencast，源文档档位 2）

```
Playwright（headless）→ CDP Page.startScreencast → screencastFrame（base64 jpeg）
   → 服务端节流（按 BROWSER_SCREENCAST_FPS 丢帧）→ 订阅者
   → 新端点 POST /api/v1/browser/stream（SSE）→ SDK → 工作台浏览器面板
   → 每帧必须回 Page.screencastFrameAck（不回就停推）
```

- **只在有订阅者时推流**：面板打开 / 关掉即起停 `startScreencast`；没有订阅者就完全不产生帧（不白烧 CPU）。
  源文档 §9 的坑 1（必须回 ack）、坑 2（帧率必须自己节流，CDP 不限速）、坑 3（`maxWidth` 跟订阅者宽度走）
  都落在这条路径上。
- **帧通道用独立 SSE 端点**，不复用全局 `/events`：帧载荷大且频，混进事件流会污染 `seq` 单调语义、
  并撞上「慢客户端断流」的逻辑（`server/src/routes/events/index.ts:20-75` 的队列上限与心跳）。
  新端点照既有 SSE 形态写（`streamSSE` + `stream.onAbort` + 心跳），**不套封套**
  （`docs/api.md:16,179-181` 的房规），在 `scripts/api-docs/endpoints.ts` 登记 `stream: true`
  （该类型已有，`:22-24`），`pnpm api:docs` 重生成。
  帧载荷：`{ type, sessionId, seq, data: { jpegBase64, width, height, url, title } }`。
  备选是 MJPEG（`<img>` 直出，省解码），但带不了 `Authorization` 头，桌面端只能靠 Cookie 或一次性 token，
  摩擦更大——**按 SSE 做**。
- 契约：`packages/contracts/src/browser/{input,output}.ts`（与 profile 管理同域），
  `packages/contracts/src/index.ts` 手写导出（该文件按域手写两行）。
- SDK：`packages/sdk/src/apis.ts` 加 browser 域；帧流客户端照 `packages/sdk/src/events.ts` 的重连 + 看门狗形态
  另起一个（帧不需要 `seq` 切分，但需要同样的「半死连接」处理）。
- UI：`packages/ui/src/business/browser/`（帧渲染、地址与状态条、动作日志、空态与错误态）+ 工作台活动栏
  新增入口（`business/workbench/workbench-activity-bar.tsx`、`workbench-sidebar.tsx`、`workbench-panel.tsx`
  的视图枚举）+ 订阅 hook（`hooks/store/`）。视觉规则按 `DESIGN.md`，版式按其「分栏」与「面板内部」两节。

## 八、优化层（源文档 §11）

三项能力，各自一个开关（默认值见「默认」列）；实现落在 `features/browser/optimize.ts`：

| 项 | 做法 | 默认 |
| --- | --- | --- |
| 快照指纹缓存 | 页面 fingerprint 未变则复用上次快照 | 开 |
| **差量回传** | 只回传变化的元素 | **关**——源文档自己标了代价：模型看到的是不完整状态。开启时结果里必须显式写「本次只回传变化部分」 |
| 激进取噪 | 更狠地丢 `generic` / 离屏 / 装饰节点 | 关（够不够用要看实测） |

另有两项不是开关、而是设计本身的一部分：**ref 复用**由 3.2 的语义哈希天然得到；
**失败分类**（可重试 / 需重快照 / 需人工）落在 3.5 的 `code` 上。

缓存只能按 page 存（多会话并发、canonical 页面可能不同），不能做进程级单例。

## 九、与源文档的口径差异

源文档是原则性方案，落到本仓库时有几处按现状改了口径（其余照做）：

| 源文档 | 本文 | 理由 |
| --- | --- | --- |
| 4 个 tool（`browser_act` 合并动作） | 5 个，加 `browser_screenshot` | headless 下模型看不见像素；pi 原生支持 image 结果，代价只是一次截图 |
| §8 方式 A：整 app 开 CDP | 不做 | 会把带 `Bearer` 注入的同源会话交给模型（第六章） |
| §15 待决策 2 建议「浏览器全局单例」 | 按 profile 持有、会话引用 | UCode 一个进程多会话、多窗口多实例（第 3.4、5.2 节） |
| §7 兜底用 Playwright 内置 Chromium | 用 `playwright-core`，探测失败即报错 | 不静默下载几百 MB 内核（第 3.3 节） |
| §9 档位 1 / 档位 4（可见 view / 推流 + 接管） | 不做，只做档位 2 | 档位 1 要桌面端视图层与挂起桥；接管（档位 4）会牵扯「人工操作与 agent 操作并发」的一整套状态机 |
| §9 推流落到「Electron 独立窗口」 | 落到工作台面板 | UCode 没有独立浏览器窗口；面板是既有的承载与分栏机制 |
| §11 差量回传（最能做出差异） | 默认关，开关式 | 源文档自己标注了「模型可能基于不完整信息决策」这条代价 |
| 未提审批与准入 | `browser_open` 默认 `ask`（subject = host）、只读模式全 deny、`file://` deny | 本仓库的模式与权限是强制口径（第六章） |
| 未提会话释放时机 | 接 `pool.dispose` / `disposeAll` + 空闲 TTL | 源文档只挂 `session_shutdown`，而 UCode 的会话会被回收与重建（第 3.4 节） |
| 未提用户数据与真实浏览器 | 拆成 isolated / attach 两种连接方式 + 命名 profile 的持久化与数据管理 | 「真实登录态」与「不碰用户数据」是两件事，混在一个开关里会把风险放大（第五章） |

## 十、实施步骤

按顺序做，每步做完即可自验（能跑的命令 / 能看的用例写在步末）；第四章的表是落点索引，这里只说顺序与产出口。

1. **契约与常量**：`packages/contracts/src/browser/{input,output}.ts`（profile 管理 + 帧流入参）+
   `index.ts` 导出；`config/{input,output}.ts` 的 `browser` 块；`constants/browser.ts` 与
   `constants/dirs.ts` 的目录常量（4.1 的表）。验：`pnpm -F @ucode/contracts typecheck`。
2. **工具名与只读门控**：`names.ts`、`profiles.ts`（第三类规则文案）、`engine.ts` 的 `toolTarget`、
   权限默认规则（`browser_open` → ask）。验：单测覆盖「只读模式对 `browser_*` 整批 deny」与
   「`browser_open` 的 subject 取 host」。
3. **提示词与 i18n**：`toolPolicy` 的浏览器分节；界面侧新增文案写 `packages/i18n/src/locales/ui/en.ts`。
   验：`pnpm verify` 的 i18n 项。
4. **浏览器探测**：`detect.ts`（6 级优先级 + 平台路径表 + 带试过路径的失败信息）。验：注入 fs / env 的单测。
5. **快照与 ref**：`snapshot.ts`（aria 提取 → 编号分配 → 指纹复用 → 导航清空）。验：纯函数单测（同指纹复用、
   导航后清空、同名元素不冲突、超上限截断）。
6. **动作与错误模型**：`actions.ts`（六个动作 + 中心点遮挡判定）、`errors.ts`。验：单测（注入
   `elementFromPoint` 桩，断言快速失败与 `staleRefs` 信号）。
7. **会话与装配接线**：`session.ts`、`registry.ts`、`index.ts` 的 5 个工具，接进
   `session-config.ts` 的 `extensionFactories`；加 `playwright-core` 依赖。验：
   `server/scripts/browser-smoke.ts`（照 `server/scripts/smoke.ts` 的形态）在临时 profile 下跑通
   open → snapshot → act → screenshot → close。**这是第一个端到端可用的点**。
8. **持久化 profile 与生命周期**：`launchPersistentContext` + profile 目录（0700）+ 引用计数 +
   空闲 TTL + 实例数上限 + `pool.dispose` / `disposeAll` 接线。验：会话回收后实例确实退出（`ps` 里无僵尸），
   TTL 到期自动关，cookie 在重开同一 profile 后仍在。
9. **与 agent-browser 对拍**：同一批页面（含遮挡弹窗、导航、动态插入元素三个场景）逐项比 `@eN` 输出与
   失败信息；差量按源文档 §12「第 2 步不能跳」的要求逐条落实。验：对拍脚本 + 结论记进本文件或
   `plans/` 下的对拍记录；用例**不进 `pnpm test`**（CI 上没有 agent-browser）。
10. **attach 模式**：配置项接线 + `connectOverCDP` + 接管语义（只用新建 page）+ `attach_failed` 错误。
    验：手动起一个带调试端口的实例连上去，`browser_close` 后该实例仍在。
11. **数据管理接口**：`profiles.ts`（列举 / 占用统计 / 删除）+ `browser/profiles` / `delete` / `clear`
    三个路由 + 使用中保护。验：单测（临时目录造几份 fake profile：删除、清空、使用中被拒、超上限不精确统计）。
12. **设置页「浏览器」分节**：连接表单（模式 / 端点 / 默认 profile）+ 数据列表（大小 / 时间 / 删除 / 清空）
    + attach 的风险提示。验：界面走查（与第 15 步合并成一次）。
13. **screencast 服务端**：`screencast.ts`（CDP session、ack、按 `BROWSER_SCREENCAST_FPS` 丢帧、
    尺寸跟随订阅者）+ 独立 SSE 端点 `POST /api/v1/browser/stream` + `endpoints.ts` 登记 +
    `pnpm api:docs`。验：`curl` 到端点能看到帧；没有订阅者时 `startScreencast` 未启动。
14. **SDK 帧流**：`packages/sdk/src/apis.ts` 加域 + 帧流客户端（重连 + 看门狗）。验：单测（mock 传输层，
    断流后重连）。
15. **工作台面板**：`packages/ui/src/business/browser/` + 活动栏入口 + 订阅 hook。验：浏览器走查
    （与第 12 步合并：帧是否动、关面板是否停推、设置页两块内容、窄屏与深色主题）。
16. **优化层**：`optimize.ts` 三项开关（第八章的表），逐项开关后回头验第 5、6、9 步的语义没被破坏。
17. **收尾**：`docs/modes-and-permissions.md`、`CHANGELOG.md`、README 的工具清单与配置说明；
    最后跑一次 `pnpm check`。

## 十一、验收口径

| 层 | 用例 |
| --- | --- |
| 单测（`server/src/harness/features/browser/__tests__/`，`node:test` + `node:assert/strict`，不依赖真浏览器） | ref 编号：同指纹复用、`framenavigated` 后清空、同名元素不冲突；遮挡判定（注入 `elementFromPoint` 桩）；错误映射与 `staleRefs`；探测层平台表（注入 fs / env）；profile 列举 / 删除 / 清空 / 使用中拒绝 / 超限不精确统计 |
| 权限 | 只读模式对 `browser_*` 整批 deny；`browser_open` 默认 ask 且 subject 取 host；档位调高也不能放宽 deny；打开 attach 不放宽任何门控 |
| 集成（`server/scripts/browser-smoke.ts`，需真浏览器） | 临时 profile：open → snapshot → act → screenshot → close；持久化 profile：重开后登录态仍在；attach：连用户实例，`browser_close` 只断开 |
| 会话 | 实例回收 / `disposeAll` 后进程确实退出（无僵尸），TTL 到期自动关，超实例数上限即失败，多会话共用同一 profile 时改动可见 |
| 配置与设置页 | 改 mode / profile 后新的一轮生效；attach 的风险提示可见；删除使用中的 profile 被拒；清空后目录为空 |
| 对拍 | 与真 agent-browser 的输出格式与失败语义逐项一致（第 9 步的结论） |
| 走查（按需，合并一次） | 工作台浏览器面板（帧是否动、关面板是否停推）+ 设置页浏览器分节（连接表单、数据列表、确认弹层）+ 窄屏与深色主题 |
| `pnpm check` | 收尾跑一次全量 |
