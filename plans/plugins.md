# 插件平台（方案）

> 状态：**架构定稿，未实施**。先落第一～四章（能装能用），再按第九章推进。
>
> 本文取代此前三份（本文件旧稿、「插件格式与兼容」、「插件市场与版本」），并把范围**收窄**到一件事：
> 插件 = 把 skills / commands / agents / hooks / MCP / bin / 代码模块打包成可启停、可分发、可升级的单元。
> 不收窄的部分（主模式、界面插槽、会话级宿主 API、能力授权）逐条列在第十一章，附不做的理由。
> plan / goal 这类内置功能的模块化**不再是插件平台的目标**，见第十二章。
>
> 引用写成「路径 + 符号 + 行号」，行号随代码演进会漂移，**以符号名为准**。

## 一、定位

插件是**资源与受信任代码的打包单位**，不是产品功能的实现方式。

三条原则：

1. **声明优先**：绝大多数插件只是文件（skill / command / agent / hooks.json / .mcp.json / bin），
   宿主读清单就能装载，插件侧没有代码。
2. **宿主是唯一执行者**：插件不 import 内核模块。带代码的插件（pi TS 扩展、hooks 模块）也只通过
   清单声明 + 事件接入，能力面等于「以服务权限运行的一段模块」。
3. **一套装载**：随包内置资产与第三方插件共用同一套发现、校验、注入与优先级，差别只在
   **来源**（自有官方来源 vs 第三方市场，见第五章）与**能不能卸载**（内置不可卸载、可禁用）。

**兼容是重点、不是降级项**：一个按 Claude Code 或 ZCode 规范写的插件，放进插件根就能用；
移植时不需要改 hook matcher、不需要改文档里的变量引用。

明确不是：插件不定义主模式、不提供界面贡献、不提供会话级 API（第十一章）。

## 二、插件模型

- **清单**：三档兼容识别（`.<slug>-plugin/plugin.json` → `.zcode-plugin/plugin.json` →
  `.claude-plugin/plugin.json`），第一个命中生效。**清单本身可缺省**：没有清单时按标准目录布局加载，
  插件名取目录名（与 Claude 一致）。
- **组件两类**：
  - **资源型**：skills / commands / agents / hooks / MCP / bin / userConfig；
  - **代码型**：`extensions/` 下的 pi TS 扩展、`hooks` 的模块式 handler（见 4.2）。
- **生命周期**：发现 → 清单校验 → 装载 → 装配注入 → 启停 → 卸载 → 相关会话按注册表 revision 重建（4.4）。
- **作用域**：安装副本只有**用户级**一处（`$APP_HOME/plugins/`，登记表 `$APP_HOME/app/plugins.json`）；
  项目级只放**启停覆盖**（`<cwd>/.<slug>/plugins.json` 提交、`plugins.local.json` 个人），
  覆盖只翻已登记插件的开关，**不能引入新代码**——理由见「十七、复盘」的作用域一节。
- **发现只认登记表**：唯一的装载依据是 `plugins.json` 的 `marketplaces` / `installed` 记录，
  **不扫插件根目录**。放进 `$APP_HOME/plugins/` 但不登记 = 不加载、也不参与来源门控。
  这是「来源即信任」（第五章）能成立的前提——否则「把目录拷进去」就等价于授予可信来源。
- **命名**：显示名 `<plugin>:<name>`、底层 token `<plugin>-<name>`；规则与冲突处理见 3.8。

## 三、包格式与兼容

### 3.1 包结构

```
my-plugin/
├── .<slug>-plugin/plugin.json   # 可选清单；也识别 .zcode-plugin / .claude-plugin 下的同名文件
├── skills/<name>/SKILL.md
├── commands/*.md
├── agents/*.md
├── hooks/hooks.json
├── hooks/*.js                   # 模块式 handler（代码型）
├── extensions/*.ts              # pi TS 扩展（ucode 专属，可选）
├── bin/<executable>
└── .mcp.json
```

`<slug>` 与清单目录名都从 `packages/brand/src/brand.ts` 的 `brand.slug` 派生（品牌校验会拦下
`server/src` 里的硬编码品牌名，见 `packages/brand/scripts/verify.ts:104-113`）。同包多清单并存取第一个、
其余记诊断。

### 3.2 清单字段

与 Claude / ZCode 同名同义：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 标识，`^[a-z0-9][a-z0-9._-]{0,127}$`；组件都命名在它下面 |
| `displayName` | string | 界面显示名，缺省用 `name` |
| `version` | string | 版本，缺省 `0.0.0`；设了就把用户固定在那一版（6.6） |
| `description` | string | 一行说明 |
| `author` | string \| `{name,email?,url?}` | 作者 |
| `homepage` / `repository` / `license` / `keywords` | string / string[] | 元数据 |
| `defaultEnabled` | boolean | 用户没设置过时是否默认启用，缺省 true |
| `skills` | path \| path[] | **叠加**默认 `skills/`（`"."` 指插件根） |
| `commands` | path \| path[] \| object | **替换**默认 `commands/`；object 支持内联 `content` |
| `agents` | path \| path[] | **替换**默认 `agents/` |
| `hooks` | path \| object \| array | 与 `hooks/hooks.json` **合并** |
| `mcpServers` | path \| object \| array | 与 `.mcp.json` **合并**，同名后者替换前者 |
| `extensions` | path \| path[] | pi TS 扩展，**叠加**默认 `extensions/` |
| `userConfig` | object | 需要用户填写的配置项（4.3） |

**注册但不执行**（识别、出诊断、不影响其它组件）：`settings`、`channels`、`lspServers`、
`outputStyles`、`workflows`、`experimental`、`types`。
`dependencies`（跨插件依赖）：**本轮只诊断忽略**，不实现解析——它要的是一套版本求解与冲突优先序，
真需要时照 Claude 的模型补（第十一章）。
未知顶层键剥离并告警，不报错。

### 3.3 路径规则

- 相对插件根，必须以 `./` 开头（`skills` 另接受 `"."` 指插件根）。
- 必须落在插件根内；含 `..`、越界、经符号链接逃出根，三种都拒绝该组件并出诊断。
- 路径不存在同样拒绝并诊断。
- 校验复用（不另写第四份）：`server/src/platform/paths/index.ts`（`resolveTargetPath` /
  `resolveExistingPath`）与 `harness/features/context` 的 realpath + 前缀判定
  （`isInside`，`harness/features/context/index.ts:52`）上提后的公共实现。

### 3.4 变量

| 变量 | 解析为 | 兼容别名 |
| --- | --- | --- |
| `${<品牌大写>_PLUGIN_ROOT}` | 插件当前版本的安装目录绝对路径 | `${CLAUDE_PLUGIN_ROOT}`、`${ZCODE_PLUGIN_ROOT}` |
| `${<品牌大写>_PLUGIN_DATA}` | `$APP_HOME/plugins/data/<sanitized-plugin-id>`，首次引用时创建，跨版本保留 | `${CLAUDE_PLUGIN_DATA}` |
| `${<品牌大写>_PROJECT_DIR}` | 会话 cwd | `${CLAUDE_PROJECT_DIR}` |
| `${user_config.KEY}` | `userConfig` 的已存值 | — |

变量名前缀由 `brand.slug` 派生（`server/src` 里不得出现硬编码品牌名字面量）。**已实现**的解析字段：
hooks 的 `command`（`harness/plugins/hooks.ts` 解析绑定命令）与 MCP 的 `command` / `args` / `env` / `url` / `headers`
（`harness/plugins/mcp.ts`）；`PLUGIN_DATA` 同时按需建目录。
**未实现**：skill / command / agent 的 Markdown 正文与 `extensions` 的模块路径——正文原样交给 pi、
我们不改写磁盘文件，`extensions` 路径不经替换。带 `userConfig` 的插件会收到一条 info 级诊断说明这点
（`components.ts` 的 `warnUserConfigInResources`），要值的插件改用 `*_PLUGIN_OPTION_<KEY>` 环境变量。
shell 形式的 hook `command` 与 MCP `headersHelper` **拒绝** `${user_config.*}`（值会被 shell 再解析）——
这是 Claude 也踩过的一条，照抄。

### 3.5 兼容边界与降级清单

| 项 | ucode 处理 |
| --- | --- |
| 清单三档位置 / 无清单的标准布局 | 都支持；多清单并存取第一个，其余诊断 |
| `settings` / `channels` / `lspServers` / `outputStyles` / `workflows` / `experimental` | 注册但不执行，诊断 |
| `dependencies` | 诊断忽略（第十一章） |
| `commands` 的 `allowed-tools` / `model` / `skills` | 诊断忽略（当普通命令） |
| hook 的 `http` / `mcp_tool` / `prompt` / `agent` 型 handler | 诊断忽略 |
| `PermissionRequest` 事件 | 不实现（诊断）——pi 无独立权限事件 |
| `monitors` 一类常驻后台进程 | 不实现（诊断）——它与会话生命周期纠缠，要单独设计 |
| 冒号命名 | 仅显示层；插件正文里的 `/plugin:name` 不会被 pi 展开（已知限制） |
| `bin/` 的 Windows 语义 | 实施时明确，不留「先 Unix」的含糊 |
| Claude / ZCode 专属能力（mods 的界面接管、ZCode 的 MCP Apps 页面等） | 只跑我们认为有意义的子集，其余出诊断（见下一条） |
| `ui`（ZCode 的 `ui.surfaces`：MCP Apps 沙箱页面） | **识别并保留该键、出诊断，不当未知字段剥离**：本轮不渲染，但也不能静默丢掉。将来真要兼容它就走 MCP Apps 沙箱页这条路（宿主去认 `ui://` 资源 + `_meta.ui.*`），而不是自造插槽 DSL（第十一章） |
| 第三方市场来的执行类组件（hooks / `extensions/` / `bin/`） | **只解析出诊断、不注入**（第五章）；资源型组件照常生效 |

### 3.6 组件格式：skills / commands

- 底层名 `<pluginToken>-<componentToken>`，显示名 `<plugin>:<componentName>`。
- 加载走**装配期**注入：`additionalSkillPaths` / `additionalPromptTemplatePaths`
  （`server/src/harness/setup/session-config.ts:181-182`），改名走 loader 的 `skillsOverride` /
  `promptsOverride`——后者与既有的内置命令 override 组合，不得覆盖 `withBuiltinPrompts`
  （`harness/setup/assets/index.ts:65`）。
- commands 的 object 内联定义与子目录扁平化（`commands/db/migrate.md` → 显示名
  `<plugin>:db:migrate`，底层 token 扁平化）。
- 只透传 pi 认的 `description` / `argument-hint` / 正文，其余 frontmatter 出诊断。

### 3.7 组件格式：agents

`agents/*.md` 的 frontmatter 走 Claude 语义：

| Claude 字段 | ucode 处理 |
| --- | --- |
| `name` | 显示名与 slug 来源（加插件前缀） |
| `description` | 直接映射 |
| `model` | 别名 `sonnet` / `opus` / `haiku` / `inherit` 忽略并回落会话默认；其余交给 `resolveModelRef` |
| `tools` | 经工具名映射表收敛为白名单；未知项诊断丢弃 |
| `disallowedTools` | 收敛为 `excludeTools`（需给 ucode 角色能力补该字段） |
| 其余（`effort` / `maxTurns` / `memory` / `background` / `isolation` / `color` / `mode`） | 诊断忽略 |

工具名映射（Claude → pi）：

```
Bash→bash  Read→read  Edit→edit  Write→write  Glob→find  Grep→grep  LS→ls
WebFetch→webfetch  WebSearch→websearch  Task→subagent
```

`mode: <slug>` 的 agent **不再解释为主模式**（第十一章）：出诊断、按普通子角色落位。
插件 agent 一律是子角色，slug 用 `<pluginToken>-<agentToken>`，需满足 ucode 的 slug 规则与长度上限。

### 3.8 命名空间与命名规则

```
显示名（UI / 引用）   my-plugin:review
底层 token            my-plugin-review
MCP 服务器名          plugin_my-plugin_review
```

- sanitize：小写；非 `[a-z0-9-]` 替换为 `-`；折叠连续 `-`；去首尾 `-`；数字开头补前缀。
- token = `<pluginToken>-<componentToken>`；跨插件冲突追加 `-<6位hash>`；
  **与两个内置技能名（`plugin-create` / `plugin-review`）冲突时同样加 hash**。
- 插件 agent 的 slug 需满足 ucode 规则（小写字母开头、`[a-z0-9-]`、长度上限）。
- 技能与提示词命令是两套索引（`CommandsListResponse` 的 `prompts` / `skills`），同名不冲突，
  但 `/` 菜单里会相邻出现，描述文案要写清适用场景。

## 四、装载与实现

### 4.1 装配期注入

插件贡献并入既有装配管道（`harness/setup/session-config.ts:214` 的 `assembleSession` /
`:141` `createSessionLoader`）：

| 组件 | 接入点 |
| --- | --- |
| skills / commands | `additionalSkillPaths` / `additionalPromptTemplatePaths` + `skillsOverride` / `promptsOverride` |
| agents | 注册表发现链纳入插件根，`AgentSource` 增 `plugin`（发现链现状见 `harness/setup/agents/custom.ts:209-216`） |
| extensions | `additionalExtensionPaths`（同一 loader 构造） |
| MCP | 合并进现有 MCP 扩展的 `loadConfig`（`harness/setup/mcp/index.ts:25-28` 的 `mcpExtension`），服务器名 `plugin_<pluginToken>_<server>`，工具名对齐 `mcp__plugin_<pluginToken>_<server>__<tool>` |
| bin | 会话 bash 的 spawn env 里把 `PATH` 追加到末尾（4.3） |
| hooks | 按事件挂到装配期的扩展工厂链（4.2） |

两条现状边界照旧：**插件 MCP 只给「默认工具集」的会话**（MCP 会激活 codemode、绕过只读白名单，
见 `session-config.ts:171` 的 `withExtensions`）；`<agentDir>/extensions` 的隐式自动加载要关掉
（会话 loader 现在没设 `noExtensions`，pi 的 `addAutoDiscoveredResources` 会扫它，那是绕过信任清单的
既存通道）。

### 4.2 hooks

事件映射：

| Claude / ZCode | pi 事件 | 决策落点 |
| --- | --- | --- |
| SessionStart | `session_start` | 首轮上下文注入（advisory） |
| UserPromptSubmit | `input` + `before_agent_start` | `input` 只能 `transform` 文本；追加上下文走 `before_agent_start` 的 `message` |
| PreToolUse | `tool_call` | 可收紧：`{block, reason}` |
| PermissionRequest | —（不实现，出诊断） | pi 无独立权限事件 |
| PostToolUse | `tool_result` | 可替换结果内容 |
| PostToolUseFailure | `tool_result`（`isError`） | 可注释错误 |
| Stop | `agent_settled` | 仅通知 / 清理。只挂它：`agent_end` 是底层循环（含重试）结束发的，两个都挂一轮会跑多遍 |
| — | — | `SessionStart` 挂在 `session_start` 上，而它是 `bindExtensions` 触发的：**所有会话都要绑扩展**（漏绑会让 plan / ask 与只读角色会话静默不跑 SessionStart） |

载体两种：

- **命令式**（与 Claude 的 settings hook 同形）：`hooks/hooks.json` 里 `type: "command"`，
  宿主起子进程。stdin 一行 JSON，字段模仿 Claude（`hook_event_name` / `tool_name` / `tool_input` /
  `tool_response` / `prompt` / `cwd` / `session_id` 等）；stdout 可选 JSON
  （`decision` / `reason` / `hookSpecificOutput.additionalContext` 等）；exit 2 视为阻断
  （stderr 作 reason），其它非 0 记日志不阻断。`matcher` 对工具名做正则匹配；`timeout` 默认 60s；
  `async: true` 只对通知类事件生效。环境变量给派生的 `*_PLUGIN_ROOT` / `*_PLUGIN_DATA` /
  `*_PROJECT_DIR` / `*_PLUGIN_OPTION_<KEY>`，并设 `CLAUDE_*` / `ZCODE_*` 别名。
- **模块式**（代码型，等价于 Claude 的 hooks 模块去掉界面能力）：`extensions/` 里的 pi 扩展，
  在服务进程内执行，按 `pi.on(...)` 挂事件。**仅此一种进程内形态**，不再另开一套插件 API。

执行口径（安全边界）：hook **只能收紧**。`PreToolUse` 的 block 与权限扩展的 `deny` 取并集；
注册顺序保证权限扩展先判定（`extensionFactories` 数组顺序即加载顺序，pi 侧依据见第十四章）。
放宽型 `permissionDecision: allow` 仅对本来 `ask` 的调用生效，对 `deny` 无效。

**只有可信来源的 hook 会被挂上**（`official` / `local`，见第五章）：第三方市场的 `hooks/hooks.json` 与
模块式 handler 仍要解析（校验形状与 matcher、路径越界、`${user_config}` 落在 shell 里这类问题都要报），
但**不注册进 pi**，诊断里写明「本 hook 未生效，因为插件来自第三方市场」。

### 4.3 MCP / bin / userConfig

- **MCP**：读 `.mcp.json` 与清单 `mcpServers`，变量替换后合并进 `loadConfig`（4.1）。
  与用户自己的 `$APP_HOME/harness/mcp.json`（`server/src/env.ts:175`）分组展示；同名以用户配置优先（出诊断）。
- **bin**：收集**可信来源**（`official` / `local`，见第五章）启用插件的 `bin/` 目录（存在且含可执行文件），
  把 `PATH` 追加到会话 bash 的 spawn env 末尾（`path.delimiter`），不遮蔽系统命令、不改 server 进程 PATH；
  第三方市场的 `bin/` 只出诊断。
  自研 shell 扩展已整体覆盖内置 bash，`shellCommandPrefix` 不生效（`harness/features/shell/index.ts:1-7`），
  所以**接缝要先开**：`createShellExtension()` 现在无参数、`spawnHook: nonInteractiveSpawnHook` 是
  构造期常量（`harness/features/shell/index.ts:19-30`、`harness/features/shell/env.ts:31-34`），
  插件 bin 目录必须在装配期传进工厂；合并顺序与 `NON_INTERACTIVE_ENV` 不冲突（后者不动 `PATH`）。
- **userConfig**：宿主按 `{ type: string|number|boolean|directory|file, title, description,
  required?, default?, options?, multiple?, sensitive?, min?, max? }` 渲染配置表单（与 Claude 同形），
  值落 `plugins.json` 的 `config`，`sensitive` 走系统凭据库（见 5）。
- **平台差异**：Windows 的可执行后缀与 `PATH` 分隔符在实施时明确并写进测试。

### 4.4 热重载与失效

**需求口径：插件变更不需要重启服务进程。** 落法只有两步，不需要更复杂的机器：

1. **注册表带 revision**。变更入口（装载 / 启停 / 卸载 / 更新 / 显式刷新）都在宿主手里，处理完
   才推进 revision，并下发 `plugins_changed` 控制帧（与 `mcp_changed` / `config_changed` 同一范式，
   `packages/contracts/src/events.ts:67-83`）。
2. **装配时把 revision 记进 `SessionEntry`**，`ensure()` 比对不一致即重建；活跃轮次沿用既有的
   「标脏等落定」语义（`core/pool.ts:1106` `recycleForConfigChange` 与 `core/recycle.ts:10`
   的 `planRecycle`）。**保护集合要包含挂起态**：`isActive` 现在只认「占位 run 或流式中」
   （`core/pool.ts:897-899`），等审批 / 等提问 / 待确认计划都不算，而 `dispose` 会把挂起请求
   按失败结算（`:1074-1078`）；插件变更的触发频率远高于配置保存，所以保护集合扩成
   「生成中 || 有待答交互 || 有待确认计划」，命中只标脏、等用户答完再回收。
   **这一条同时修掉配置变更的同类问题**（保存配置会打回正在等审批的会话，没有插件平台时也是错的）。

**代码型插件的换版本靠目录，不靠进程内热替换。** Node 的 ESM 按解析路径缓存，裸 `import()`
同一路径拿到的是旧模块实例；所以插件安装成**带版本的目录**：
`$APP_HOME/plugins/cache/<market>/<plugin>/<version>/`，
`${*_PLUGIN_ROOT}` 指向它，新版本 = 新路径 = 新模块。旧版本目录延迟清理（会话可能还在用），
不重写文件、不做哈希目录名的替换。

**手改文件走显式刷新**：`plugins/refresh`。不做 `fs.watch`——编辑器原子写与 `git checkout` 的成批抖动、
半写包被扫到、跨平台递归监听的坑，收益只对插件作者成立。

**两代共存允许**：旧会话用旧代码跑完，新会话用新代码；状态里记各会话的 revision，设置页可提示
「还有 N 个会话在用旧版本」。

**仍然要重启的只有一种**：改内核代码（`pnpm build && pnpm start -- --restart`，仓库既有的自迭代约定），
与插件无关。

## 五、信任与安全

**来源即信任**（策略对齐 ZCode 的 P0）：不搞能力声明与逐插件授权表，而是把**执行类组件按来源门控**。
三个来源：`official`（随包 seed + 我们自己的官方市场）、`local`（用户显式登记的本地目录）、
第三方市场（含 `claude-plugins-official`）。实现以这三档为准（旧稿用过 `packaged` 这个词，指的就是
`official` 里随包的那一半，本文已统一）；契约里的资产来源枚举是另一回事，它只给前端标「这个技能来自哪」，
见第十章。

| 组件 | 随包 / 我们官方市场（`official`） | 本地目录（`local`，用户显式登记） | 第三方市场（含 `claude-plugins-official`） |
| --- | --- | --- | --- |
| skills / commands / agents | 注入 | 注入 | 注入 |
| MCP servers（独立进程） | 启用即生效 | 启用即生效 | 启用即生效 |
| hooks（命令式 / 模块式）、`extensions/` 模块、`bin/` | 注入 | 注入 | **不注入：只解析出诊断** |

- **为什么本地目录也算可信**：它是用户自己登记、路径可见的代码（开发态、团队内部包），不给这一档就没人能测 hooks；
  两个内置市场里的第三方包才是「看不见作者、只能读清单」的那一类。
- **为什么 MCP 在第三方那一档也照常生效，hook 却不行**：MCP 是独立进程，与用户手写的 `mcp.json` 走同一条
  路径，有自己的配置展示与审批面；hook 是插进 agent 循环里的内联命令，没有第二道闸，所以第三方那一档不注入。
- **第三方不注入的代价要说在明处**：装一个带 hooks 的 Claude 插件，命令、技能、MCP 都能用，
  但 hook 不会跑——设置页与 `plugin-review` 技能的诊断里要直说这一条，不能默不作声。
- **可审查**：设置页与 `plugin-review` 技能列出：清单与路径越界、hook 命令（shell 注入、`${user_config}`
  落在 shell 里、curl 管道执行）、`bin/` 内容、MCP 配置（command / url / headers 里的 token）、
  `extensions/` 模块的调用面、网络与写盘范围。**审查是给人看的，不是运行期的授权判定。**
- **总开关**：一个开关停掉全部执行类组件（资源型照常加载）。
- **权限**：插件规则只收紧（与 `deny` 取并集）；涉及命令执行的组件与 `bash` 同权限档，只读模式不给；
  边界以 [`modes-and-permissions.md`](../docs/modes-and-permissions.md) 为准。
- **隔离**：项目级只有开关覆盖，且只对已登记的 id 生效；覆盖里出现没装过的 id 一律忽略（不出安装、不出下载）。
- **状态与密钥**：`plugins.json` 0600；`userConfig` 非敏感值明文存该文件，`sensitive` 走系统凭据库
  （同 Claude / ZCode），取不到凭据库时拒绝保存而不是回落明文。
- **Windows**：`bin/` 与路径处理的平台语义在实施时明确。

参照：ZCode 的 `apps/zcode-cli/docs/design/v2/plugin-compat.md`——“只把 skills、custom commands、
MCP servers 与**可信官方** hooks 投进现有能力域；来自非官方第三方市场的 hook 文件只做诊断解析，
在它长出显式信任门之前不注入运行时”。我们照这条，只多给「本地目录」一档（否则开发态无法测 hooks）。

**明确不做**：能力声明（`capabilities`）与授权表（grants）、逐插件信任矩阵、云同步签名，
以及「给第三方执行类组件开一个显式信任开关」——后者等真有需求再说（第十一章）。

## 六、来源、市场与版本

### 6.1 来源形式

| 来源 | 输入 | 实现 |
| --- | --- | --- |
| `directory` | `path`（本地目录） | 直接引用，不复制（先落地） |
| `url` | `url` + `headers?`，`.zip` / `.tgz` | 自研（pi 不认 http tarball / zip） |
| `npm` | `package`（`@scope/name@1.2.3`） | 自研（见 6.4） |
| `github` | `repo` / `path?` / `ref?`，也接受 `owner/repo` 简写 | 自研 clone |
| `git` | `url` / `path?` / `ref?` | 自研 clone |
| 市场内相对路径 | 字符串 | 即本地目录 |
| `command` | 命令输出目录 | **不做**（Claude 有；收益低、审查面反而更大，第十一章） |

未实现的来源在校验阶段返回 `plugin_source_invalid` 并给出「该来源尚未支持」的明确诊断——不留静默失败。

### 6.2 市场清单

- 清单文件 `marketplace.json`，三档识别规则与插件清单一致。
- **本地市场**：指向一个目录，读其中的 `marketplace.json`，条目里的相对路径相对该目录解析。
- **url 市场**：`marketplace.json` 直链；没有本地仓库，因此**条目必须用显式来源**，
  相对路径条目在校验阶段拒绝并出诊断。
- 形状（沿用 Claude 约定）：

```json
{
  "name": "my-market",
  "description": "…",
  "plugins": [
    { "name": "hello", "source": "./hello", "version": "1.0.0", "category": "demo", "tags": ["…"] },
    { "name": "from-github", "source": { "source": "github", "repo": "owner/repo", "path": "p", "ref": "main" } }
  ]
}
```

- url 市场拉取走公共网络底座（6.5）：SSRF 准入 + 手动重定向 + 大小上限 + `ETag` / `Last-Modified`
  条件请求；缓存到 `$APP_HOME/plugins/marketplaces/<market>/marketplace.json`，记录
  `sha256` / `fetchedAt` / `lastError`。刷新失败**保留上次缓存**并出诊断；**内置的那两个市场**
  失败只落 `lastError`、不出用户可见错误（它们不是强依赖）。

**开箱内置的市场**（与 ZCode 的 `DEFAULT_PLUGIN_MARKETPLACES` 同形同源，见
[`zai-org/ZCode`](https://github.com/zai-org/ZCode) 的 `packages/shared/src/plugin-marketplaces.ts`）：

| id | 来源 | 档位 | 状态 |
| --- | --- | --- | --- |
| `claude-plugins-official` | `anthropics/claude-plugins-official`（git 简写） | `official` | **已内置**；GitHub 不可达时刷新必然失败，这种失败**静默处理** |
| `zcode-plugins-official` | `https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`（url 直链，与 ZCode 仓库同名同址） | `market` | **已内置**：33 个条目，全是 `url + zip` 来源，可一键安装。它在自家 Agent 里会把「随包 seed 分片」与 CDN 分片合并，**我们只读 CDN 清单** |
| `<slug>-plugins-official` | CDN 上的 `marketplace.json` 直链 | `official` | **待接入**：CDN 地址未定，不在这里编造地址；定下来再补一行，并带上随包 seed 分片与 CDN 分片的合并 |

`builtin`（随包写入状态 + 刷新失败静默）与信任档位是**两件事**（`marketplaceRecordSchema.trust`）：
前者解决「用户开箱就能看到市场」，后者决定「它的 hooks / extensions / bin 能不能注入运行时」。
ZCode 官方市场是别人的市场，且它的插件确实带可执行脚本（`video2code` 的 `hooks/*.py`），
所以默认 `market` 档——技能 / 命令 / MCP 照常可用，代码类组件只出诊断。要提档就改这一处字段。

两条约定：首次启动把内置市场写入状态（用户可删，卸载只移除登记、不碰已有缓存）；
市场身份用 id、插件身份用 `<name>@<marketplace>`（例：`hello@my-market`）——状态文件的 key、日志、
会话里的引用都用这个形状（磁盘目录另按来源分，见 6.3）。id 进目录名时只保留字母、数字、`_`、`-`，
其余字符一律替换为 `-`。

这两个市场同时是兼容性的**基准夹具**：清单形状、条目字段、插件包目录就读它们，不自己造样例（第十三章）。

### 6.3 落盘与状态

```
$APP_HOME/plugins/                                      # 插件根：市场缓存 + 手放的包（手放的也要登记才加载）
$APP_HOME/plugins/cache/<market>/<plugin>/<version>/    # 复制型插件的安装副本（${*_PLUGIN_ROOT} 指向它）
$APP_HOME/plugins/marketplaces/<market>/                # 市场清单缓存（每市场一个目录）
$APP_HOME/plugins/data/<sanitized-plugin-id>/           # ${*_PLUGIN_DATA}，跨版本保留
$APP_HOME/app/plugins.json                              # 状态（0600）
```

目录形状**对齐 ZCode**（`plugins/{cache,marketplaces,data}`，缓存按 `<market>/<plugin>/<version>`
分三层）：省一份心智模型，也便于与它对拍。状态文件仍在我们自己的 `app/` 下（它与 `config.json` 同类，
都是服务生成的状态）；插件数据目录与缓存同层，因为那是插件自己的资产。

`plugins.json`：

```json
{
  "marketplaces": [
    { "name": "my-market", "source": { "source": "directory", "path": "…" }, "lastRefreshAt": "…" }
  ],
  "installed": [
    {
      "id": "hello@my-market",
      "name": "hello",
      "version": "1.0.0",
      "source": { "source": "directory", "path": "…" },
      "path": "…",
      "scope": "user",
      "enabled": true,
      "integrity": "sha256:…",
      "installedAt": "…",
      "revision": 12
    }
  ],
  "config": { "hello@my-market": { "apiKey": "…" } }
}
```

项目级只承载启用覆盖，键是插件 id、值是布尔：

```json
{ "enabledPlugins": { "hello@my-market": true, "other@local": false } }
```

`<cwd>/.<slug>/plugins.json`（提交进仓库，团队共用）与 `<cwd>/.<slug>/plugins.local.json`（个人覆盖，
建议 gitignore）两份，**local 压过 project、project 压过登记表**；逐 id 取值，没提到的 id 用登记表里的值。
插件视图带 `enabledBy`（`user` / `project` / `local`），界面据此说明「这个值是谁定的」并把开关置灰。
读盘坏掉只记一条诊断，按「文件不存在」处理。

`installed[].path`：`directory` 源指向源目录（不复制，改源码即生效），其余来源指向 cache 里的
版本副本目录（见上面的目录树）。两种都只是缓存字段，真身份是 `id`。

`revision` 是全局注册表代次（4.4），写在这里便于排查「哪个会话用的是哪一代」。

### 6.4 插件包拉取与解包

**不复用 pi 的包管理器安装路径，改用 `execa` 自调。** 三处依据：

1. **子进程输出必然污染日志**。pi 的安装子进程是
   `stdio: isStdoutTakenOver() ? ["ignore", 2, 2] : "inherit"`（`dist/core/package-manager.js:2145`），
   而 `isStdoutTakenOver()` 只在 pi 自己接管 stdout（TUI）时为真——server 下恒为 `inherit`，
   子进程会绕过 pino 直接写 stdout。不是「可能」，是必然。
2. **声明不落盘**：`installAndPersist` 依赖文件型 settings，而会话装配用的是
   `SettingsManager.inMemory()`（`harness/setup/session-config.ts:256`）；插件来源身份存在我们自己的
   `plugins.json` 里，装配时以路径注入，不碰 pi 的 settings。
3. **环境要求**：机器上需要 `npm` 与 `git` 可执行文件；缺失时出诊断，不让服务崩。

形态：`npm install --prefix <目标目录>`、`git clone --depth 1 --branch <ref>`，自己收 stdout / stderr
进日志、自己报进度。git 侧现状约束：`services/git` 的 `runGit` 只读取向（固定参数、10s 超时、
16 MiB 缓冲，`server/src/constants/tools.ts:63,66`），clone 需要单独的参数组合与超时；
私有仓靠系统 git 凭据，失败出诊断（`GIT_TERMINAL_PROMPT=0` 决定它直接失败），**我们不落任何明文凭证**。

**解包**：`fflate`（zip）+ `tar`（tgz），纯 JS、无原生编译（`node:zlib` 有 gzip / inflateRaw
但没有 tar 解析器，pax / longlink / symlink 属高风险解析器，不自己写）。新增依赖要同时改根
`package.json` 与 `server/package.json` 且版本一致（`scripts/verify/checks/manifest.ts:24-33`）。
解包后清单必须在包根，组件路径仍走 `./` 前缀 + 根内校验。

### 6.5 网络与限额

- **网络底座**：把 `harness/setup/tools/ssrf.ts` 的 `assertPublicUrl`（`:78`）与 `webfetch.ts` 的手动
  重定向取流（`:116-141`，每跳重新准入）上提到 `server/src/platform/net/`（webfetch 反向引用），
  供路由层与市场复用。

| 项 | 规则 |
| --- | --- |
| 准入 | 只允许 `https`；复用 `assertPublicUrl`，**每一跳重定向重新准入**，跳数上限 5 |
| 体积 | 压缩体 ≤ 32 MiB、解包后总量 ≤ 128 MiB、条目数 ≤ 5000，超限报 `payloadTooLarge` |
| 路径穿越 | 拒绝绝对路径、`..` 段、超长路径；符号链接与硬链接解包时丢弃并记诊断 |
| 校验 | url 源记响应 sha256 进状态；npm 走 registry 的 integrity |
| 代理 | 现状 `fetch` 不读 `HTTP_PROXY`（Node 需显式配置）；作为已知边界写进 `docs/plugins.md` |

### 6.6 版本检查与更新

| 来源 | 版本判定 |
| --- | --- |
| `directory` | 目录内容哈希（无版本可比时给「已变更」标记；有清单 `version` 时优先比版本） |
| `github` / `git` | `git ls-remote` 比 ref 的 commit |
| `url` | 条件请求的 `ETag` / `Content-Length` / `Content-Digest` 比本地 `integrity` |
| `npm` | registry 的 dist-tags 与版本列表比本地 `integrity` 与 `version` |

清单 `version` 优先：设了它就把用户固定在那一版，直到作者改字符串（与 Claude 一致）。

触发时机：

- `plugins/list` 只读缓存结果，**不打网络**（避免打开设置页就联网）。
- `marketplace/refresh` 刷新市场清单并顺带重算已装插件的可更新状态，结果落状态与缓存。
- `plugins/refresh` 重新拉取到目标版本，随后按 4.4 推进 revision 并重建相关会话。

### 6.7 旧版本清理

换版本 / 同版本重拉时把旧目录改名成 `cache/<市场>/<插件>/.orphaned-<版本>-<时间戳>`，
在里面写 `.orphaned_at` 标记，**14 天**后由清扫删除（会话可能还握着 `${*_PLUGIN_ROOT}` 指着的旧路径）。
清扫的触发点是服务启动、安装、重拉与「勾了清理缓存的卸载」，且**只在还有已装插件时**跑（与 Claude 同）；
判过期以标记文件的 mtime 为准，读不到退回目录 mtime。`${*_PLUGIN_DATA}` 不随版本清理。

### 6.8 接口

- 域 `marketplace`：`list` / `create` / `delete` / `refresh`（动作都在 `docs/api.md` 的封闭词表内）。
- 插件侧：安装 = `plugins/create`（`source` 取 6.1 的形式），登记取消 = `plugins/delete`
  （只移除登记与状态，不删磁盘内容除非 `--purge`），启停与配置 = `plugins/update`，
  重拉 = `plugins/refresh`。
- 进度：长耗时的安装 / 解包把子进程输出转成控制帧，设置页显示进度与失败原因，不做轮询。
- 契约：`PluginView` 增 `latestVersion?` / `updateAvailable` / `checkedAt?` / `revision`；
  市场视图含 `lastRefreshAt` / `refreshedOk`。

## 七、内置资产

内置资产是**随包**的插件与技能，与第三方共用同一套装载与优先级。两类落盘不同，别混：
**技能与提示词**（无清单、无版本目录）物化到 `$APP_HOME/app/builtin/`；
**随包插件包**（有清单、有版本，如将来的 `browser-use`）与第三方插件走同一条流水线——seed 进官方市场
cache（`$APP_HOME/plugins/cache/<slug>-plugins-official/<name>/<version>/`，即 6.2 说的 seed 分片）。

- **单一注册表**：`kind` ∈ `prompt` / `skill`。现有 `BUILTIN_PROMPT_COMMANDS`
  （`server/src/harness/setup/assets/builtin.ts:19` 的 `/review`）迁入为 `kind: "prompt"`。
- **来源与优先级**：来源恒标 `official`（随包），优先级**恒为最低**（磁盘 / 用户同名者胜出）。
- **物化只给需要磁盘真身的类型**：

  | kind | 接入方式 |
  | --- | --- |
  | `prompt` | 内存合成 `PromptTemplate`（现状），`builtin:<name>` 合成路径 |
  | `skill` | 物化到 `$APP_HOME/app/builtin/skills/<id>/SKILL.md`（pi 的 `Skill` 只有 `filePath`，模型靠 `read` 取正文，命中记录也认这个路径） |

- **物化语义**：幂等（内容相同跳过）、升级按内容覆盖、不做哈希目录名（否则命中记录里的路径每次升级都变）；
  物化相位早于第一次装配与 `/` 菜单列举。
- **完整性与回退（ZCode 的 `requiredSeedPaths` 做法）**：每个内置资产声明必需文件，缺件时**拒绝生成
  残缺缓存、回退到上一个可用版本并诊断**；不能因为一个内置资产缺文件把启动与会话恢复整体拖挂。
- **云同步口子**：注册表对外只暴露 `resolveBuiltinAssets()`——先取随包集合，配置了中继且云端清单可用时
  按 id 用云端版本替换；拉取失败或离线**静默回落**（云同步是可选增强，服务不因中继不可达而失败）。
  状态记 `$APP_HOME/app/builtin/manifest.json`（`id` / `kind` / `version` / `sha256` / `origin` /
  `fetchedAt`）。中继侧接口约定见 [`relay.md`](./relay.md)。

### 7.1 两个内置技能

| 技能 | 用途 | 真身 | 物化 |
| --- | --- | --- | --- |
| `plugin-create` | 引导创建一个 ucode / Claude / ZCode 都能认的插件包 | `server/src/harness/plugins/builtin/skills/plugin-create/{SKILL.md,references/…}` | `$APP_HOME/app/builtin/skills/plugin-create/SKILL.md` |
| `plugin-review` | 审计第三方插件（审查清单见第五章） | 同上的 `plugin-review/` | 同上的物化 |

调用方式 `/skill:plugin-create`、`/skill:plugin-review`，来源标 `official`；`plugin-review` 的描述要写明
「审计第三方插件」，与内置命令 `/review`（审查代码改动）区分。正文真身用 Markdown 文件 + esbuild
`loader: { ".md": "text" }` 内联；零构建改动的替代是照 `builtin.ts` 写 TS 常量。
命名冲突：插件的组件 token 是 `<plugin>-<name>`，**两个内置技能名视作已占用**，冲突时插件侧追加 `-<6位hash>`。

### 7.2 插件开发文档

真身与内置技能同源，避免两处维护：`docs/plugin-authoring.md` 由 `plugin-create` 的技能真身拼出
（脚本生成 + `pnpm verify` 比对，与 `docs/api-reference.md` 同一套做法）；`docs/plugins.md` 手写
（用户向：安装、启停、兼容降级表、安全边界、已知限制）。`pnpm check` 加一条「技能正文 ⇄ 仓库文档」
一致性校验。

## 八、界面

插件**没有界面贡献能力**（第十一章），界面上只多三处：

- **设置页 Plugins 分页**：列表（来源、版本、启停状态、revision）、详情（组件清单与诊断）、
  配置（`userConfig` 表单）、启停、卸载、本地目录登记、执行类组件的来源标记与「总关」开关、
  以及「本 hook / bin / 扩展未生效（来自第三方市场）」的逐条诊断。
- **设置页「市场」区块**：市场列表（添加 / 删除 / 刷新）、市场内插件（安装 / 更新 / 已装标记 /
  版本对比）、诊断与进度。本地目录市场的表单最简单（一个路径输入 + 校验结果）。
- **`/` 菜单**：插件的 commands / skills 与内置的同列（已是数据驱动，`hooks/use-commands.ts`
  走 `commands/list`）。

客户端刷新：`plugins_changed` 控制帧 → SDK 的 `plugins` store（`packages/sdk/src/stores/plugins.ts`
+ `hooks/use-plugins.ts`，与 `mcp` 域同一范式）。

## 九、实施顺序

1. **合同先落**：契约（`plugins` / `marketplace` 域 + 既有视图扩展 + 错误码 + i18n）、`plugins.json`
   状态、`harness/plugins/{manifest,registry,sanitize}` 与单测。
2. **资源接入**：装配期注入 skills / commands / agents + 改名 + `/` 菜单透出 + 会话按 revision 重建
   + Claude / ZCode 真实形状夹具。
3. **执行类组件**：hooks（事件映射、block 与 `deny` 取并集、matcher、timeout）、bin（先给 shell 工厂
   开参数）、插件 MCP（`loadConfig` 合并）、`extensions`、`noExtensions` 关闭；**全部按来源门控**（第五章）。
4. **设置页与内置资产**：Plugins 分页 + 配置表单 + 执行类组件的来源门控与总开关；内置资产注册表 +
   物化 + 完整性回退 + `manifest.json` + `plugin-create` / `plugin-review` + `/review` 迁入 +
   `docs/plugin-authoring.md` 生成与校验。
5. **市场**：本地目录市场 + 版本检查 → url 市场与网络底座 → 包拉取与解包（六类来源、限额与穿越防护）。
6. **热重载收尾**：revision 与 `plugins_changed` 贯通 + 挂起态保护 + 版本目录与旧版本清理。

每一步收尾跑一次 `pnpm check` 与对应验收（要收窄范围用 `--filter`，不要在一轮里反复全量跑），
做完停下等 review。

## 十、落位（服务端）

```
server/src/harness/plugins/         宿主：manifest.ts  registry.ts  sanitize.ts
                                    adapters/{skills,commands,agents,hooks,mcp,bin,extensions}.ts
                                    index.ts
server/src/harness/plugins/builtin/ 内置资产：registry.ts  materialize.ts  skills/plugin-create/…  skills/plugin-review/…
server/src/services/plugins/        状态读写（plugins.json）、来源登记、市场解析、版本比对、安装与解包
server/src/platform/net/            网络底座（从 harness/setup/tools 上提，供路由与市场复用）
server/src/routes/plugins/          plugins / marketplace 两个域的路由
packages/contracts/src/plugins/     input.ts  output.ts
packages/contracts/src/marketplace/ input.ts  output.ts
```

- 插件贡献并入装配走 `harness/setup/`（装配管道）；宿主不 import `core` 的运行时值。
- 契约域只有 `input.ts` / `output.ts`，导出要在 `packages/contracts/src/index.ts` 手写两行。
- 错误码只加实际会返回的：`plugin_not_found` / `plugin_manifest_invalid` /
  `plugin_component_invalid` / `plugin_source_invalid` / `marketplace_invalid`；
  每个都必须同步 `packages/i18n` 的 `error-messages.ts` 与 `domain` 文案（否则 typecheck 失败）。
  登记处是 `packages/contracts/src/envelope.ts:39` 的 `ERROR_CODES`。
  **没有「信任 / 授权」类错误码**：来源门控的后果是「组件不注入 + 诊断」，不是拒绝请求（第五章）。
- 既有枚举扩展：`COMMAND_ASSET_SOURCES`（`packages/contracts/src/constants.ts:559`，数组顺序即同名优先级）、
  `AGENT_SOURCES`（`:575`）增 `plugin`，都插在 `builtin` **之前**（用户显式装的优先于随包内置）；
  这两个枚举是**契约给前端标「资产来自哪」**的口径，与第五章的信任来源是两回事。
  `PromptCommandView` / `SkillCommandView` / `AgentView` 增
  `displayName` / `plugin`（按需）。**注意**：`contracts/src/constants.ts` 已 583 行，贴着 600 行的
  强制拆分线，这一轮改它时一并评估按域拆分。
- 路由注册在 `server/src/app.ts:61-80`（挂载 `:82`），并在 `scripts/api-docs/endpoints.ts` 登记、
  `generate.ts` 的 `DOMAIN_LABELS` 补中文标题、`pnpm api:docs` 重生成 `docs/api-reference.md`。
- SDK：`packages/sdk/src/apis.ts` 加域、`stores/plugins.ts`、`client.ts` 三处、`index.ts` 导出、
  `hooks/use-plugins.ts`。
- 设置页与界面：`packages/ui/src/lib/settings-section.ts`、`business/settings/settings-sections.tsx`
  与 `settings-panel.tsx`（分区）。

### 10.1 要先改的内核代码（不是插件自己的活）

1. **shell 工厂参数化**：`createShellExtension()` 收启用插件的 bin 目录，把 PATH 追加进 spawn env（4.3）。
2. **`noExtensions`**：会话 loader 显式关掉 `<agentDir>/extensions` 的隐式加载
   （行为变更进 `CHANGELOG`）。
3. **会话重建**：`SessionEntry` 记注册表 revision，`ensure()` 比对不一致即重建；同时把挂起态
   并进保护集合（4.4）。
4. **layers 校验规则**：`scripts/verify/checks/layers.ts:43-84` 的 `RULES` 加一条——`harness/plugins`
   是接缝层，`harness/{pi,setup,features}`、`core`、`platform` 不得反向依赖它
   （`harness/plugins → core` 已有通用规则覆盖，只许 `import type`）；并把 `harness/pi` 的禁依赖名单
   （`:50-56`，现在只有 `setup` / `features`）补上 `plugins`。

## 十一、明确不做（本轮定稿的排除项）

| 排除项 | 理由 |
| --- | --- |
| **插件定义主模式**（`modes`） | Claude 也不给。一旦给，就要配套「能力上限收敛、工具白名单、权限只收紧、档位不放宽、会话按模式重建」一整串约束；模式继续做内核概念（三个内建 slug + 自定义 `.md` 覆盖，见 `harness/setup/agents/custom.ts:275`）成本低得多 |
| **界面贡献**（`slots`、七原语、`when`、`componentId`、`plugin_event`） | 第三方插件没有界面面。要「插件改界面」这条路，业界的做法是代码型事件 + 重绘（Claude 的 mods），不是自造一套声明式 DSL；真要做得照那个模型，且必须解决「画不出来的环境降级成一行文本」 |
| **会话级宿主 API**（`sessionHooks`、`injectTurn`、`onTurnSettled`、`storage.kv`、`plugins/invoke`） | 它们只服务「产品功能以插件形态实现」，而那条路已经不走了（第十二章） |
| **能力声明与授权**（`capabilities` / grants / 逐插件信任矩阵） | 执行面按**来源**门控就够（第五章）：第三方市场的 hooks / `extensions` / `bin` 不注入，资源型组件不需要授权申请。声明式能力清单收不紧它——能收的只有「跑不跑」，而那由来源决定 |
| **云同步下发的可执行内容签名** | 云同步只下发内置资产（第七章，纯声明：技能与提示词），没有可执行内容要签 |
| **清单 `apiVersion` 门禁** | 宿主 API 面已经小到「就是清单字段」；未知字段剥离 + 诊断已经足够让降级可见，再加一个拒绝加载的理由不划算 |
| **插件 `dependencies` / `command` 来源 / `monitors`** | 各自都需要一套独立机器（版本求解与冲突优先序 / 命令输出目录的信任与重跑 / 常驻进程与会话生命周期的关系），收益不抵成本；识别并诊断忽略 |
| **`fs.watch` 自动感知** | 变更入口都在宿主手里；手改文件走显式 `plugins/refresh`（4.4） |
| **给第三方执行类组件开「显式信任」开关** | 那是又一套逐插件授权，只是换个名字。真需要时的做法是 ZCode 说的「explicit trust and permission gate」：先有需求与设计（怎么展示、怎么回退、升级后是否重新确认），再加；本轮只出诊断（第五章） |

## 十二、不属于本文的事

两件事常被误当成插件平台的一部分，都不是：

- **`plan` / `goal` 这类内置功能的模块化**：它们是随包代码 + 原生界面 + 自己的表，不需要插件清单、
  不需要能力授权、不需要界面插槽、也不需要热重载（随产品版本走）。要拆的是「内核不该认识具体模式」
  这类依赖方向问题，属于内核内部重构，另立任务跟进（见 [`TODO.md`](../TODO.md)）。
- **「agent 操作浏览器 / 桌面端」**：它需要「服务端挂起 + 客户端执行」的桥，而插件宿主跑在 server
  进程内、物理上够不到桌面端主进程；即使插件机制落地，这条桥也要单独做（见
  [`builtin-browser.md`](./builtin-browser.md)）。

## 十三、测试与验收

`server/src/harness/plugins/__tests__/`，`node:test`，断言用 `node:assert/strict`，不引第三方框架。

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| PLG-01 | 三档清单定位、并存、无清单的标准布局 | 取第一个/按目录扫，其余记诊断 |
| PLG-02 | 路径规则 | `./` 前缀、越界 / `..` / 符号链接逃出 / 不存在，四种都拒绝并诊断 |
| PLG-03 | 不支持字段 | 注册但不执行，出诊断，其它组件正常 |
| PLG-04 | sanitize / 命名 | 显示名与底层 token 正确；跨插件冲突与内置技能名冲突都加 hash |
| PLG-05 | skills / commands 改名 | `skillsOverride` / `promptsOverride` 后名称正确，且不覆盖内置命令 |
| PLG-06 | agent frontmatter 翻译 | 工具名映射、`disallowedTools`、model 别名回落、`mode` 被忽略并诊断 |
| PLG-07 | hook 事件映射 | PreToolUse block、PostToolUse 改内容、exit 2 语义、与 `deny` 并集、matcher、timeout |
| PLG-08 | MCP 变量替换与命名 | 服务器名 `plugin_<plugin>_<server>`，与用户 `mcp.json` 同名时用户优先 |
| PLG-09 | bin PATH | 注入 spawn env，追加在 `$PATH` 之后 |
| PLG-10 | userConfig | 表单值落 `plugins.json`；`sensitive` 不落明文；`${user_config.*}` 在 shell 字段被拒 |
| PLG-11 | 状态读写 | `plugins.json` 增删改、项目级启停覆盖（`enabledPlugins` + local > project > user）、`revision` 推进 |
| PLG-12 | 会话重建 | revision 变化后相关会话被重建；有待答交互的会话只标脏不回收 |
| PLG-13 | 内置资产 | 物化幂等、升级覆盖、名冲突与 frontmatter 校验、`manifest.json` 写入、云端不可达回落 |
| PLG-14 | 市场解析 | 三档识别、相对路径条目在 url 市场被拒、来源形式逐类解析、未实现来源报错 |
| PLG-15 | 版本判定 | 目录内容哈希、semver 对比、ref commit 对比（本地 git 仓库造夹具，不连外网） |
| PLG-16 | 解包 | zip 与 tgz 各一例，含路径穿越、symlink、超限三类拒绝 |
| PLG-17 | 网络 | SSRF 私网地址被拒；条件请求缓存命中（mock 传输层，不真连） |
| PLG-18 | 旧版本清理 | 换版本写 `.orphaned_at`；未到期的旧目录不被删；`${*_PLUGIN_DATA}` 不受影响 |
| PLG-19 | 来源门控 | 第三方市场的 hooks / `extensions` / `bin` 都不进运行时且出诊断；`official` 与 `local` 的同样组件正常注入；总开关能单独停掉执行类组件 |
| PLG-20 | 发现只认登记表 | 手放进 `$APP_HOME/plugins/` 的目录不被加载、其 hooks / `extensions` / `bin` 也不注入；登记后才生效 |

**夹具**：`server/src/harness/plugins/__tests__/fixtures/` 放真实 Claude Code 与 ZCode 插件的目录形状
（三档清单各一例、无清单的标准布局一例、含 `settings` / `channels` 等不支持键、含 hooks / `.mcp.json` /
agents / bin），逐条验证「识别正确 + 诊断正确 + 其它组件不受影响」。

**兼容基准就用两个内置市场**：把它们（与我们要对拍的真插件包，如 `browser-use` / `computer-use`）的
清单与目录形状离线存档进 `fixtures/`，当作形状与条目字段的基准；联网抓真实市场的用例标成网络依赖，
不进默认 `pnpm test`。

**L4 / L5**：`pnpm smoke` 加一条「启用含 skill 的插件后模型可调用」；浏览器走查设置页 Plugins 分页
整套（列表 / 详情 / 配置 / 来源标记 / 总关 / 启停）、市场区块、`/` 菜单里的插件项、`plugin-review` 技能可被调用。

## 十四、已核对的 pi 侧事实

实施时不必再查（升级 pi 后需重核）：

| 事实 | 出处 |
| --- | --- |
| loader 支持 `additionalExtensionPaths` / `additionalSkillPaths` / `additionalPromptTemplatePaths` / `skillsOverride` / `promptsOverride` / `noExtensions` | `dist/core/resource-loader.d.ts:75-97` |
| `DefaultPackageManager` 是公开导出，含 `setProgressCallback` / `getInstalledPath` / `checkForAvailableUpdates` | `dist/index.d.ts:17`、`dist/core/package-manager.d.ts:66,67,87,94,120` |
| 安装子进程 `stdio` 只在 pi 接管 stdout 时被抑制，其余情况 `inherit` | `dist/core/package-manager.js:2145`、`dist/core/output-guard` |
| hook 处理器按**扩展加载与注册顺序**执行；`tool_result` 处理器逐个组合、每个看到前一个的改动 | `docs/extensions.md:97`、`:105` |
| `<agentDir>/extensions` 会被隐式自动加载 | `DefaultResourceLoader` 的 `addAutoDiscoveredResources`（`userDirs.extensions = join(globalBaseDir, "extensions")`） |
| `Skill` 只有 `filePath` 指向磁盘真身，技能正文靠模型 `read` 取 | `dist/core/skills.d.ts:13` |

## 十五、风险与边界

- **代码执行面**：`extensions/` 与模块式 hook 以 server 权限运行，但**只有 `official` / `local` 来源会被注入**；
  第三方市场的执行类组件只出诊断。残留风险在本地目录那一档（用户自己登记、路径可见，但仍然是完整代码执行），
  与 Claude / ZCode 的取舍一致，写进 `docs/plugins.md` 让用户知道。
- **平台差异**：`bin/`、`PATH` 分隔符、shell 形式 hook 的引号规则在 Windows 上语义不同，落地前定策。
- **代理**：`fetch` 不读 `HTTP_PROXY`，受限网络下市场与包拉取会失败。
- **热重载的边界**：代码型换版本靠目录，所以会短时并存两份代码（旧版本目录延迟清理）；插件自己起的
  常驻进程（定时器、子进程、监听端口）宿主收不回，只能靠文档约定它们跟着会话/进程退出。
- **`userConfig` 的敏感值**依赖系统凭据库；取不到时拒绝保存，不回落明文。

## 十六、需要同步的文档

| 文档 | 改动 |
| --- | --- |
| `docs/plugins.md`（新） | 用户向：安装、启停、两个内置市场（及它们的刷新失败策略）、兼容降级表、安全边界与信任提示、已知限制 |
| `docs/plugin-authoring.md`（生成） | 面向插件作者，由 `plugin-create` 真身生成并校验 |
| `docs/api.md` | plugins 与 marketplace 两个域 |
| `docs/api-reference.md` | `pnpm api:docs` 重生成 |
| `AGENTS.md` | 目录约定加 `harness/plugins/`、`harness/plugins/builtin/`、`services/plugins/`、`platform/net/`；`$APP_HOME` 布局加 `plugins/`（`cache` / `marketplaces` / `data`）、`app/plugins.json`、`app/builtin/`；**「`harness/features/*` 后续迁成插件」的说法作废**（第十二章） |
| `CHANGELOG.md` | 未发布段（接口、目录、`noExtensions` 行为变更） |

## 十七、复盘

落实过程中改口径 / 补实现的几处，供后续参考：

| 项 | 计划写的 | 实际做法与理由 |
| --- | --- | --- |
| 安装进度 | 「把子进程输出转成进度帧」 | 只发**阶段**帧（下载 / 解包 / npm 安装 / 克隆）：逐行喂帧会把事件流刷爆，npm 的输出也不是稳定的机器可读格式；原始输出按调试级进日志 |
| `${user_config.*}` | 在 Markdown 正文里也替换 | 只替换 hook 命令与 MCP 配置（都是我们装配时经手的字符串）；正文原样交给 pi，改盘上的文件代价与风险都不划算，改为出诊断 |
| 插件 MCP | 合并进 `loadConfig` | 已实现（`loadPluginMcp` + `mergePluginMcpServers`），插件条目 `scope: "extension"`、排用户条目之后，同名以用户配置优先 |
| 市场条目一键安装 | — | 计划外补的：条目 `source` 在刷新时解析成绝对来源（相对路径按市场根），`marketplace/info` 返回，前端复用 `plugins/create` |
| `file` 类型配置项 | — | 计划外补的：与目录选择共用一个弹层（`select: "file"`），选文件时点文件即确认 |
| 旧版本清理 | §6.7 的 `.orphaned_at` + 14 天清扫 | 照 Claude Code 的口径落地：旧副本改名成 `.orphaned-<版本>-<时间戳>` + 标记文件、14 天保留、只在有已装插件时清扫（它的原文也点明了清扫依赖同根下的账本）。触发点放在 commit 之后：首次安装时 commit 前登记表还是空的 |
| `SessionStart` 的会话范围 | 计划只写了 `SessionStart → session_start`，没提会话模式 | 原先只在 `mode === "build" && usesDefaultToolSet` 时调 `bindExtensions`（那是为 MCP 加的），于是只读 / plan / ask 会话静默不跑插件 SessionStart。现在**所有会话都绑扩展**；挂的扩展本来就少（没有 MCP、没有 tool_search），代价可以忽略 |
| 项目级作用域 | 项目级安装根 `<cwd>/.<slug>/plugins/` + 启用覆盖 | 只做**启用覆盖**，装副本留在用户级。查了九家：Claude Code（`enabledPlugins`，6 档优先级，且明说「不扫项目 `.claude/plugins/`」）、Codex（`[plugins."name@market"] enabled`，未信任整层跳过）、VS Code agent plugins（同一键形）都是「用户级装 + 项目级开关」；ZCode 更直接——**项目级 hooks 整段不执行**（`config_project_hooks_ignored`），团队共享请走插件。只有 Obsidian（vault 即部署单元）与 opencode / Amp（文件即加载、无开关）把本体放进工作区。另外安装根在项目内会让 §6.7 的清扫失去前提（Claude Code 的清扫依赖同根下的 `installed_plugins.json`）。故：**项目文件永远不能把新代码带进这台机器** |
