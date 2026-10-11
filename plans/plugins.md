# 插件平台（方案）

> 状态：**架构定稿，未实施**。先把设计写成文档，再按第十三节的依赖顺序动代码。
>
> 配套文档：[`plugin-format.md`](./plugin-format.md)（包格式、组件与 Claude / ZCode 兼容）、
> [`plugin-market.md`](./plugin-market.md)（来源、拉取、解包、版本检查与更新）、
> [`relay.md`](./relay.md)（内置资产云同步的中继侧接口约定）。
>
> 本文取代本文件此前的「插件机制 v1」稿（原文已由本次重写替换）：那一版的落位与接缝多处与
> 当前代码不符，逐条修正见第九节。
>
> 全文的路径与行号已对齐 `AGENTS.md`「server 目录约定」的分层（`routes → services → core → harness → pi`，
> `harness/` 分 `pi` / `assemble` / `features` 三组 + 跨组原语）。

## 一、定位

插件是一等公民——不是给内核打补丁的扩展点，而是产品功能的**第一实现方式**。目标模式、计划模式
这类今天写在 `server/src/harness/` 里的功能，今后以插件形态实现与演进。

三条原则：

1. **宿主是唯一入口**：插件不 import 内核模块，只声明能力并调用宿主 API（`PluginContext`）。
2. **同一套接缝**：内置插件与第三方插件共用同一份清单、同一套接缝、同一套 API、同一套生命周期；
   差别只在**来源**（随包 / 云同步 / 第三方）与**信任门槛**。
3. **声明式优先**：界面贡献先走声明（宿主渲染），跨 web / 桌面 / TUI 一致，且第三方插件无法往
   客户端注入任意 JS；原生 React 组件只对随包内置插件开放。

## 二、分层与边界

| 层 | 职责 | 不许越界 |
| --- | --- | --- |
| 内核 kernel | 会话生命周期与装配顺序、权限最终裁决、DB 与迁移、鉴权、事件总线、日志、宿主本身 | 不承载具体功能；目标模式这类能力不应留在核心里 |
| 宿主 host | 插件发现、清单校验、能力授权、加载与装配、运行期调度、诊断、状态存储、API 暴露 | 不实现业务功能，只提供接缝 |
| 插件 plugin | 清单 + 声明式贡献 + 可选代码（TS 模块）与资源文件 | 不 import 内核模块，只调宿主 API |
| 应用层 apps | web / desktop / TUI：订阅插件事件、渲染声明式贡献、按 `componentId` 挂原生组件 | 不替插件实现业务逻辑 |

这条边界不是审美选择。`goal` 的现状正好说明问题：它的状态机、提示词、阈值、UI 组件本来就能留在
插件内，真正卡住的是内核没给编排钩子与存储槽位——`startInjectedRun` 是 `SessionPool` 私有方法
（`server/src/core/pool.ts:352`）、落定后的编排写死在 `agent_settled` 监听里（`pool.ts:816`）、
目标状态是专用列且占用了第 4 号迁移（`server/src/db/index.ts:46-48`）。

## 三、插件模型

- **清单**：三档兼容识别（`.<slug>-plugin/plugin.json` → `.zcode-plugin/plugin.json` →
  `.claude-plugin/plugin.json`），ucode 专属键放可选字段；字段表、路径规则、变量、组件格式与
  兼容降级表见 [`plugin-format.md`](./plugin-format.md)。
- **组件两类**：
  - **资源型**：skills / commands / agents / hooks / bin / MCP / TS 扩展；
  - **功能型**：`modes`（主模式）、`tools`（自定义工具）、`slots`（界面贡献）、`actions`
    （可被调用的动作）、`permissionRules`、`sessionHooks`、`storage`、`events`。
- **生命周期**：发现 → 清单校验 → **能力授权** → 加载 → 装配注入 → 运行（动作 / 钩子 / 事件）→
  停用 / 卸载 → 相关会话按启用集指纹重建。
- **作用域**：用户级 `$APP_HOME/plugins/`；项目级 `<cwd>/.<slug>/plugins/`，**默认不启用**。
- **命名**：显示名 `<plugin>:<name>`、底层 token `<plugin>-<name>`；规则与冲突处理见
  [`plugin-format.md`](./plugin-format.md) 第八节。

## 四、宿主 API（`PluginContext`）

| API 组 | 能力名 | 作用域 | 信任要求 |
| --- | --- | --- | --- |
| `assets.register*`（skills / commands / agents 路径申报与改名） | 隐式 | 插件 | — |
| `modes.register`（主模式：工具集 / 权限规则 / 档位 / 推荐思考档 / 提示词 / 选择器条目） | `modes` | 会话 | — |
| `tools.register`（声明自定义工具，实现仍在插件代码内） | `tools` | 会话 | 代码执行 |
| `slots.contribute`（声明式界面贡献） | `slots` | 全局 | — |
| `actions.register`（插件动作，经统一端点调用） | `actions` | 全局 | — |
| `events.emit`（`plugin_event` 会话帧） | `events` | 会话 | — |
| `storage.kv`（global / project / session 三档） | `storage` | 三档 | — |
| `session.on*`（`assemble` / `onTurnSettled` / `injectTurn` / `onDispose` / `onModeChange`） | `sessionHooks` | 会话 | 代码执行 |
| `model.completeSimple` + `usage.query`（旁路模型调用与区间用量） | `model` / `usage` | 会话 | 代码执行 |
| `log` / `diagnostics` | 隐式 | 插件 | — |

运行期检查而非仅启用时提示：**未声明的能力调用直接拒绝**。权限相关有两条硬约束——插件注册的
权限规则与权限扩展的 `deny` 取并集（**只能收紧**）；模式自带的权限档位只能落在不放宽的一侧
（`default` / `auto`，不得默认给 `full`）。

## 五、一级接缝

### 5.1 主模式

| 现状缺口 | 目标形态 |
| --- | --- |
| 插件目录不在角色发现链里（`harness/setup/agents/custom.ts:215` 只认 `.ucode/agents` 与 `$APP_HOME/agents`） | 发现链纳入插件根，`AgentSource` 增 `plugin` |
| 自定义角色的权限规则被写死清空（`custom.ts:173`） | 由 `modes.permissions` 提供，走既有 `AgentProfile.capability.permissions` 与 `parentModeRules`（`harness/setup/agents/capability.ts:103-107`） |
| 无 `excludeTools`（`capability.ts:69` 的 primary 路径恒为 `[]`） | 角色能力补该字段，插件声明经工具名白名单收敛 |
| 无权限档位字段（`AgentProfile` 无此项，`session-config.ts:167` 只读会话行） | 加模式级默认档位，取值顺序：会话行 > 模式默认 > 全局默认，且默认落在不放宽侧 |
| 能力上限无约束（`primaryCapability` 拿全量声明） | 插件模式的能力必须 ⊆ 内核默认集，`KNOWN_TOOL_NAMES`（`harness/setup/tools/names.ts:57`）之外的声明一律拒绝 |
| 提示词只有三个内置 slug（`harness/setup/prompt/locales/zh-CN.ts:102-113`，未知 slug 得空串） | 插件自带正文 + 分节，装配时并入 |

会话参数本身不必改：`sessions.mode` 已是字符串 slug，契约只校验形态（`packages/contracts/src/sessions/input.ts:16-20`），
存在性查注册表（`capability.ts` 查注册表）；`$APP_HOME/agents/*.md` 今天就能覆盖内置模式
（`custom.ts:279`）。

### 5.2 界面

- **选择器改数据源**：`packages/ui/src/business/mode-picker.tsx:14,27,53` 现在读契约常量
  `SESSION_MODES` 且 `ICONS` 只认三个 slug；改为消费注册表（`agents/list` 一类的视图，含
  `displayName` / `description` / `icon` 回落）。`@ucode/sdk` 需补 agents store（今天只有
  `packages/sdk/src/apis.ts:260-264` 的无状态方法，无 store、无 hook）。
- **插槽**：`session-header` / `composer-top` / `composer-toolbar` / `message-row` / `panel` /
  `settings-section` / `command`。声明式贡献由宿主用既有基础组件渲染原语：表单字段（文本 / 多行 /
  选择 / 开关 / 数字）、列表、文本、状态条、按钮（触发 `plugins/invoke`）、链接、分隔。
- **原生组件**：按 `componentId` 查前端注册表，仅随包内置插件可用（前端代码随产物编译）。
- 明确不做：第三方往 web 注入任意 JS；TUI 与 web 的一致性靠声明式贡献保证。

### 5.3 数据

| 项 | 现状 | 目标 |
| --- | --- | --- |
| 会话事件帧 | `EVENT_NAMES` 是封闭枚举（`packages/contracts/src/events.ts:29-53`），`data` 已是 `unknown`（`:63`） | 增 `plugin_event`，载荷 `{ pluginId, kind, data }`；客户端按 `pluginId` / `kind` 订阅 |
| 控制帧 | 判别联合 `ServerControlEvent`（`events.ts:79-83`） | 增 `plugin_changed`（插件列表 / 状态变更） |
| 会话条目 | DTO 按白名单透传（`core/serialize.ts:404-460`），条目类型必须与文档双向登记（`scripts/verify/checks/session-entries.ts:24-30`） | 插件条目以插件 id 前缀注册到运行期注册表，内核条目仍走静态登记 |
| 存储 | 功能自带专用列（如 `session.goal_state`，第 4 号迁移） | 统一 `plugin_state` 表（`pluginId` + 作用域 + key → JSON），迁移归内核；会话删除时清理会话作用域 |

### 5.4 调用面

插件动作经**统一端点**调用：`POST /api/v1/plugins/invoke`，载荷 `{ pluginId, action, payload }`。
理由：`scripts/verify/checks/api-docs.ts:29-37` 的端点校验只认静态 `router.post("…")`，动态挂载的
插件路由过不了校验；统一端点还能一次收齐鉴权、封套、请求校验与日志。`invoke` 需登记进
`docs/api.md` 的动作表（那是封闭词表）。

### 5.5 编排（会话生命周期钩子）

| 钩子 | 用途 | 现状对应物 |
| --- | --- | --- |
| `assemble` | 注入工具、工具钩子、提示词片段 | `harness/setup/session-config.ts` 的装配链（`:219` `assembleSession`） |
| `onTurnSettled` | 一轮落定后运行编排（判定、续跑、清理） | `pool.ts:816` 的 `agent_settled` 监听 |
| `injectTurn` | 服务端注入一轮（不占用户队列） | `pool.ts:352` `startInjectedRun`（私有） |
| `onDispose` | 实例回收时释放插件资源 | `pool.ts:1079` `goals.forget` |
| `onModeChange` | 模式切换时的暂停 / 恢复语义 | `routes/sessions/index.ts:234` |

硬约束：钩子不得打断进行中的一轮，回收沿用「活跃者标脏、空闲者立即丢弃」的既有语义
（`core/pool.ts:1112` `recycleForConfigChange` 与 `core/recycle.ts` 的 `planRecycle`）。

## 六、内核锁死清单

插件永远碰不到的东西：会话生命周期与装配顺序、权限引擎的最终裁决与 `deny` 优先级、DB 迁移与
schema、鉴权与凭证、事件总线的投递顺序与 seq 语义、日志与进程边界。插件想做而落在这张表里的事，
说明接缝设计不足，而不是给插件开后门。

## 七、内置插件与内置资产

### 7.1 内置资产机制

内置资产是内置插件的子集（纯声明形态），两者共用一套注册与物化机制。

- **真身与来源分离**：真身 `{ id, kind, version, files }` 与来源无关；来源 `packaged`（随包）或
  `cloud`（中继下发）。
- **单一注册表**：`kind` ∈ `prompt` / `skill` / `tool` / `plugin`。现有 `BUILTIN_PROMPT_COMMANDS`
  （`server/src/harness/setup/assets/builtin.ts:19` 的 `/review`）迁入为 `kind: "prompt"`。
- **统一来源与优先级**：来源恒标 `builtin`、优先级**恒为最低**（磁盘 / 用户同名者胜出）；插件侧
  `PLUGIN_SOURCES` 从一开始就含 `builtin`。
- **物化只给需要磁盘真身的类型**：

  | kind | 接入方式 | 理由 |
  | --- | --- | --- |
  | `prompt` | 内存合成 `PromptTemplate`（现状） | pi 的模板是内存对象，`builtin:<name>` 合成路径即可 |
  | `skill` | 物化到 `$APP_HOME/app/builtin/skills/<id>/SKILL.md` | pi 的 `Skill` 只有 `filePath`（`dist/core/skills.d.ts:9-16`），模型靠 `read` 取正文，命中记录也认这个路径 |
  | `plugin` | 物化到 `$APP_HOME/app/builtin/plugins/<id>/`，由插件 registry 以隐式启用项加载 | 插件包天然是目录形态 |
  | `tool` | 代码注册（`harness/setup/tools` + 能力清单 + 权限规则），注册表只登记元数据 | 工具是代码不是文件 |

- **物化语义**：幂等（内容相同跳过）、升级按内容覆盖、不做哈希目录名（否则命中记录里的路径每次
  升级都变）；物化相位早于第一次装配与 `/` 菜单列举。
- **云同步口子**：注册表对外只暴露 `resolveBuiltinAssets()`——先取随包集合，配置了中继且云端清单
  可用时按 id 用云端版本替换；拉取失败或离线**静默回落**随包版本，服务不因中继不可达而失败
  （与 `server/src/env.ts` 那套「缺失即报错」明确区分：云同步是可选增强）。状态记
  `$APP_HOME/app/builtin/manifest.json`（`id` / `kind` / `version` / `sha256` / `origin` /
  `fetchedAt`），随包资产今天也写。中继侧接口约定见 [`relay.md`](./relay.md)。

### 7.2 内置插件形态

内置插件 = **声明**（物化到 `$APP_HOME/app/builtin/plugins/<id>/`）+ **代码**（随包编译的模块，
向宿主注册）。用户可禁用、不可卸载；升级随包或云同步覆盖。首个内置插件将是 `plan`（见第十节）。

### 7.3 两个内置技能

| 技能 | 用途 | 真身 | 物化 |
| --- | --- | --- | --- |
| `plugin-create` | 引导创建一个 ucode / Claude / ZCode 都能认的插件包 | `server/src/harness/plugins/builtin/skills/plugin-create/{SKILL.md,references/…}` | `$APP_HOME/app/builtin/skills/plugin-create/SKILL.md` |
| `plugin-review` | 审计第三方插件：清单与路径越界、hook 命令（shell 注入、`${user_config}` 落在 shell 里、curl 管道执行）、`bin/` 内容、MCP 配置（command / url / headers 里的 token）、TS 扩展的代码执行面、试图放宽权限、网络与写盘范围；输出按「阻断 / 警告 / 提示」分级 | 同上的 `plugin-review/` | 同上的物化 |

调用方式 `/skill:plugin-create`、`/skill:plugin-review`，来源标 `builtin`；`plugin-review` 的描述要
写明「审计第三方插件」，与内置命令 `/review`（审查代码改动）区分。正文真身用 Markdown 文件 +
esbuild `loader: { ".md": "text" }` 内联（正文长且含代码块，写成 JS 模板串易错）；零构建改动的替代
是照 `builtin.ts` 写 TS 常量。命名冲突：插件的组件 token 是 `<plugin>-<name>`，**两个内置技能名视作
已占用**，冲突时插件侧追加 `-<6位hash>`。

### 7.4 插件开发文档

真身与内置技能同源，避免两处维护：`docs/plugin-authoring.md` 由 `plugin-create` 的技能真身拼出
（脚本生成 + `pnpm verify` 比对，与 `docs/api-reference.md` 同一套做法）；`docs/plugins.md` 手写
（用户向：安装、启停、兼容降级表、安全边界、已知限制）。`pnpm check` 加一条「技能正文 ⇄ 仓库文档」
一致性校验。

## 八、信任、能力与安全

- **能力授权**：清单声明 `capabilities`，启用时展示并落 `plugins.json` 的 grants；升级引入新能力
  重新确认；运行期未声明即拒绝。
- **执行类组件**（hooks / bin / TS 扩展 / 自带工具 / 会话钩子）逐插件信任；随包内置插件视为可信；
  **云同步下发的可执行内容需签名 + 显式信任**，只接受配置的中继域，逐文件 sha256 校验。
- **权限**：插件规则只收紧（与 `deny` 取并集）；模式档位不放宽；涉及命令执行的组件与 `bash`
  同权限档，只读模式不给；边界以 [`modes-and-permissions.md`](../docs/modes-and-permissions.md) 为准。
- **隔离**：项目级插件默认不启用；`storage.kv` 按作用域校验，插件读不到其它插件与其它会话的数据。
- **Windows**：`bin/` 与路径处理的平台语义要在实施时明确（此前记为「先 Unix」，插件平台不能留这个
  含糊，落地前定策）。

## 九、相对旧稿的修正（代码事实）

| 旧稿写法 | 实际 |
| --- | --- |
| `server/src/agent/plugins/` | `server/src/agent/` 不存在；装配层是 `harness/setup/session-config.ts`（`:146` `createSessionLoader`、`:219` `assembleSession`、`:323` `buildSessionOptions`）。落位见第十四节 |
| 在 `resources_discover` 里申报 skills / prompts | 该事件在 `session_start` 后由 `bindExtensions` 触发，而绑定只在 `mode === "build" && usesDefaultToolSet`（`core/pool.ts:732`）；plan / ask 会话拿不到。改为**装配期**注入 loader 的 `additionalSkillPaths` / `additionalPromptTemplatePaths` / `skillsOverride` / `promptsOverride`（`session-config.ts:186-189`） |
| bin 走 `settingsManager.applyOverrides({ shellCommandPrefix })` | 自研 shell 扩展已整体覆盖内置 bash，该设置不生效（`harness/features/shell/index.ts:1-8`）。改为往会话 bash 的 spawn env 注入 PATH（`harness/features/shell/env.ts` 的范式，`path.delimiter`，追加在末尾不遮蔽系统命令） |
| 插件 MCP 用 `pi.registerMcpServer` | 现状不用它，只有 `createMcpExtension({ loadConfig })`（`harness/setup/mcp/index.ts:29`）。插件 MCP 合并进那个 `loadConfig`，命名 `plugin_<plugin>_<server>`，`mcp.json` 同名优先；配置路径是 `$APP_HOME/harness/mcp.json`（`env.ts:128`），不是旧稿写的 `$APP_HOME/agent/mcp.json` |
| 「启用集指纹 + 回收」 | 现状只有「配置代次 + stale」（`pool.ts:1112`，唯一调用点是配置保存 `services/config.ts:60`）。装配时把指纹记进 `SessionEntry`，`ensure()` 比对不一致即重建；活跃轮次沿用 `planRecycle` 的标脏语义 |
| hooks 只在 build 模式 | `pool.ts:732` 的条件要按「本次装配是否挂了需要绑定的扩展」判定：`assembleSession` 返回 `needsBind`（plugins 扩展不带 MCP，不会激活 codemode、不会绕过只读白名单） |
| `${UCODE_PLUGIN_ROOT}` 等字面量 | brand 校验扫 `server/src` 命中品牌名即报错（`packages/brand/scripts/verify.ts:100-113`）。清单目录、项目级目录、变量名全部从 `brand.slug` 派生（`CLAUDE_*` / `ZCODE_*` 别名保持字面量） |
| `$APP_HOME/harness/extensions` 自动加载 | 会话 loader 未设 `noExtensions`，pi 会扫 `<agentDir>/extensions` 自动加载——这是绕过信任模型的既存通道，定策关掉，TS 扩展统一走插件信任清单（变更记 `CHANGELOG`） |
| 动作名 `marketplace/add`、`enable`、`disable`、`configure` | `docs/api.md` 的动作是封闭词表，这些都不在表内。复用既有动作：`plugins/list` / `create` / `update` / `delete` / `refresh`；市场用 `marketplace/list` / `create` / `delete` / `refresh`；插件动作调用登记新动作 `invoke` |
| 插件 agents 一律落 subagent | 与「用插件实现计划模式 / 目标模式」冲突。改为：`modes` 是定义主模式的正式通道，`agents/*.md` 里 `mode: <slug>` 仍兼容（Claude 插件只有 agents），两者合并进同一注册表 |

## 十、迁移路线（按依赖顺序，不设版本边界）

| 序 | 动作 | 完成判据 |
| --- | --- | --- |
| 1 | 宿主 + 接缝骨架 + 资源型组件 | 第三方（Claude / ZCode 格式）插件能装、能启停、不支持字段有诊断 |
| 2 | 模式接缝 + 界面贡献 → **`plan` 迁成内置插件** | `plan` 行为对等；内核里 `mode === "plan"` 的分支消失；选择器改读注册表 |
| 3 | 编排钩子 + 统一存储 / 事件 / 插槽 → **`goal` 迁成内置插件** | 目标模式行为对等；`mode === "build"` 的三处硬编码消失；插件禁用后会话不崩 |
| 4 | 其余功能按同一套接缝迁（工作台面板、记忆、命令与技能索引等） | 每迁一块，`harness/` 少一个专用子系统 |

迁移期间功能不得回退：新旧两套并存时，以插件声明的结果为准，内核里的旧分支先保留、等对等后再删。

## 十一、必须消失的内核硬编码（迁移的量化目标）

| 位置 | 现在 | 迁完后 |
| --- | --- | --- |
| `harness/setup/session-config.ts:293` | 记忆工具按 `mode === "build"` | 由插件声明的作用域决定 |
| `core/pool.ts:732` | `bindExtensions` 按 `mode === "build"` | 按装配返回的 `needsBind` |
| `routes/sessions/index.ts:234` | 切走 `build` 即暂停目标 | 由目标插件自己订阅 `onModeChange` |
| `harness/setup/agents/profiles.ts:72` | `Record<SessionMode, …>` 锁死三个模式 | 注册表查询 |
| `harness/setup/agents/capability.ts:92` | `isReadOnlyCapability` 只认「整批 deny 写工具」 | 能力标记（`reads` / `writes` / `plans`）由声明给出 |
| `packages/ui/.../mode-picker.tsx:14,27,53` | 常量列表 + 三个硬编码图标 | 注册表数据 + 图标回落 |
| `packages/ui/src/lib/mode.ts:5-31` | 三个内置 slug 的文案 | 注册表提供的 `displayName` / `description` |

## 十二、实施顺序

1. **合同先落**：契约（`plugins` / `marketplace` 域 + 既有视图扩展 + 错误码 + i18n）、
   `plugins.json` 状态、`harness/plugins/{manifest,registry,sanitize}` 与单测。
2. **资源接入**：装配期注入 skills / commands / agents + 改名 + `/` 菜单与选择器透出 + 会话按指纹
   重建 + Claude / ZCode 真实形状夹具。
3. **执行类组件**：hooks（事件映射、block 与 `deny` 取并集、matcher、timeout）、bin（spawn env）、
   插件 MCP（`loadConfig` 合并）、TS 扩展（信任清单）、`noExtensions` 关闭。
4. **内置资产**：注册表 + 物化 + `manifest.json` + 来源分层与回落；`plugin-create` /
   `plugin-review` 两个技能 + `/review` 迁入 + `docs/plugin-authoring.md` 生成与一致性校验。
5. **宿主与接缝**：`PluginContext`、能力授权、`slots` / `actions` / `events` / `storage`、
   `plugins/invoke`、`plugin_event` / `plugin_changed` 帧。
6. **界面**：设置页 Plugins 分页（列表、详情、组件、诊断、启停、配置、本地目录登记、信任开关）、
   `/` 菜单插件项、agent 选择器、模式选择器改数据源。
7. **迁移**：`plan` → `goal`（第十节的 2 / 3 步）。
8. **市场**：见 [`plugin-market.md`](./plugin-market.md)。

每步收尾跑一次 `pnpm check` 与对应验收（要收窄范围用 `--filter`，不要在一轮里反复全量跑），
做完停下等 review。

## 十三、测试与验收

`server/src/harness/plugins/__tests__/`，`node:test`，沿用现有夹具写法。

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| PLG-01 | 三档清单定位与并存 | 取第一个，其余记诊断 |
| PLG-02 | 路径规则 | `./` 前缀、越界 / `..` / 不存在拒绝并诊断 |
| PLG-03 | 不支持字段 | 注册但不执行，出诊断，其它组件正常 |
| PLG-04 | sanitize / 命名 | 显示名与底层 token 正确；跨插件冲突与内置技能名冲突都加 hash |
| PLG-05 | skills / commands 改名 | `skillsOverride` / `promptsOverride` 后名称正确，且不覆盖内置命令 |
| PLG-06 | agent frontmatter 翻译 | 工具名映射、`disallowedTools`、model 别名回落 |
| PLG-07 | hook 事件映射 | PreToolUse block、PostToolUse 改内容、exit 2 语义、与 `deny` 并集 |
| PLG-08 | MCP 变量替换与命名 | 服务器名 `plugin_<plugin>_<server>`，与用户 `mcp.json` 同名时用户优先 |
| PLG-09 | bin PATH | 注入 spawn env，追加在 `$PATH` 之后 |
| PLG-10 | 市场解析 | 各来源形式解析正确；版本对比 |
| PLG-11 | 状态读写 | `plugins.json` 增删改与项目级启用覆盖 |
| PLG-12 | 会话失效 | 启用集指纹变化后相关会话被重建 |
| PLG-13 | 模式注册 | 插件模式进注册表、能力上限收敛、权限规则只收紧 |
| PLG-14 | 能力授权 | 未声明能力调用被拒；升级新增能力要重新确认 |
| PLG-15 | 内置资产 | 物化幂等、升级覆盖、名冲突与 frontmatter 校验、`manifest.json` 写入、云端不可达回落 |
| PLG-16 | 界面贡献 | 声明式贡献进插槽数据；第三方 `componentId` 被拒 |
| PLG-17 | 动作调用 | `plugins/invoke` 的路由、校验、错误封套与鉴权 |
| PLG-18 | 插件条目与帧 | 插件条目注册与前缀规则；`plugin_event` 下发与订阅 |

L4 / L5：`pnpm smoke` 加一条「启用含 skill 的插件后模型可调用」；浏览器走查设置页整套、`/` 菜单
插件项、模式选择器、插槽渲染、`plugin-review` 技能可被调用。

## 十四、落位与接口

宿主不是一层，是跨三处的组件；落位对齐 `AGENTS.md`「server 目录约定」的 `harness/` 三组与 `services/`：

```
server/src/harness/plugins/         宿主·接缝：manifest.ts  registry.ts  sanitize.ts
                                    adapters/{skills,commands,agents,hooks,mcp,bin,extensions}.ts
                                    host.ts  index.ts
server/src/harness/plugins/builtin/ 内置插件与内置资产：registry.ts  materialize.ts
                                    plan/  goal/  skills/plugin-create/…  skills/plugin-review/…  prompts（/review 迁入）
server/src/services/plugins/        状态读写（plugins.json）、来源登记、市场解析与版本比对
server/src/db/plugin-state-repository.ts  plugin_state 表读写
server/src/routes/plugins/          plugins / marketplace 两个域的路由
packages/contracts/src/plugins/     input.ts  output.ts
packages/contracts/src/marketplace/ input.ts  output.ts
```

- 插件贡献并入装配走 `harness/setup/`（装配管道）；`injectTurn` / `onTurnSettled` / `onDispose`
  由 `core/pool` 以**回调配柄**的形式交给宿主，宿主不得 `import` core 的运行时值
  （`scripts/verify` 的 layers 校验会拦下）。
- 内置资产（`prompt` / `skill` / `tool` / `plugin` 四类）的注册与物化落 `harness/plugins/builtin/`：
  它服务于插件平台，不是命令技能索引的一部分。运行期物化路径仍为 `$APP_HOME/app/builtin/`。
- 契约域只有 `input.ts` / `output.ts`，导出要在 `packages/contracts/src/index.ts` 手写两行。
- 错误码只加实际会返回的：`plugin_not_found` / `plugin_manifest_invalid` /
  `plugin_component_invalid` / `plugin_source_invalid` / `plugin_requires_trust` / `marketplace_invalid`；
  每个都必须同步 `packages/i18n` 的 `error-messages.ts` 与 `domain` 文案（否则 typecheck 失败）。
- 既有枚举扩展：`COMMAND_ASSET_SOURCES`、`AGENT_SOURCES` 增 `plugin`；`PromptCommandView` /
  `SkillCommandView` / `AgentView` 增 `displayName` / `plugin` / `invoke`（按需）。
- 路由注册在 `server/src/app.ts:61-82`，并在 `scripts/api-docs/endpoints.ts` 登记、`generate.ts`
  的 `DOMAIN_LABELS` 补中文标题、`pnpm api:docs` 重生成 `docs/api-reference.md`。
- SDK：`apis.ts` 加域、`stores/plugins.ts`、`client.ts` 三处、`index.ts` 导出、`hooks/use-plugins.ts`。
- 设置页：`packages/ui/src/lib/settings-section.ts`、`business/settings/settings-sections.tsx`、
  `settings-panel.tsx` 分发 + 新页组件。

## 十五、风险与边界

- **代码执行面**：hooks / bin / MCP / TS 扩展 / 插件工具都以 server 权限运行，信任模型必须到位；
  云同步下发的可执行内容风险最高。
- **声明式界面的表达力上限**：状态条、配置表单、按钮、列表够用；消息流内部深度耦合的 UI
  （如目标模式的逐轮细线）要么由内核提供更丰富的原语，要么留在原生内置插件里。
- **插件 API 不做向后兼容**（项目处于开发初期，不维护兼容）：清单必须有 `apiVersion`，宿主对
  不匹配**拒绝加载并出诊断**，不静默降级。
- **性能**：插件发现与装配结果按启用集指纹缓存，避免每会话扫盘；钩子不得引入每步的额外往返。
- **热更**：会话池长驻，指纹失效必须可靠，否则插件变更对旧会话不可见。
- **`userConfig` 密钥**：状态文件 0600，明文存储；敏感值的安全存储另行排期。

## 十六、需要同步的文档

| 文档 | 改动 |
| --- | --- |
| `docs/plugins.md`（新） | 用户向：安装、启停、兼容降级表、安全边界、已知限制 |
| `docs/plugin-authoring.md`（生成） | 面向插件作者，由 `plugin-create` 真身生成并校验 |
| `docs/api.md` | 动作表登记 `invoke`，插件与市场域 |
| `docs/api-reference.md` | `pnpm api:docs` 重生成 |
| `docs/session-entries.md` | 插件条目规则（前缀注册） |
| `docs/modes-and-permissions.md` | 插件定义模式后，「模式从哪来」的口径更新 |
| `AGENTS.md` | 目录约定加 `harness/plugins/`、`harness/plugins/builtin/`、`services/plugins/`；`$APP_HOME` 布局加 `plugins/` 与 `app/plugins.json`、`app/builtin/` |
| `CHANGELOG.md` | 未发布段（接口、目录、`noExtensions` 行为变更） |
| `plans/{agent-tools-and-modes,stage-11-goal,input-commands-skills}.md` | 标注「后续以插件形态实现」，迁移后再改正文 |

## 十七、复盘

> 待落地后补。
