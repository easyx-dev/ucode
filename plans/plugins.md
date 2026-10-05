# 插件机制（方案）

> 状态：**未开始**。本文只描述设计与改动点，不含实现代码；落地过程中产生的偏差记到文末「复盘」。
>
> 目标：给 ucode 一套插件机制。插件格式与 Claude Code / ZCode **同形**——一个插件可打包
> skills / commands / agents / hooks / bin / MCP，支持从市场安装与启停；ucode 只读自己的插件根，
> 不读他方安装目录、不做格式转换。

## 一、目标与范围

**做**

- 插件格式与清单：`.ucode-plugin/plugin.json`，兼容识别 `.zcode-plugin/plugin.json` 与
  `.claude-plugin/plugin.json`。
- 插件根与发现、启用状态、会话按启用集失效重建。
- 组件适配：skills / commands / agents / hooks / bin / MCP。
- pi TS 扩展（ucode 专属能力，需逐插件信任）。
- 市场：github / git / url / npm / 本地目录；安装 / 卸载 / 更新 / 启停 / 配置。
- 契约域、路由、设置页 Plugins 分页、`/` 菜单与 agent 选择器透出。

**不做（v1）**

- 读他方安装目录（`~/.claude`、`~/.zcode` 等）与其 settings。
- 安装时格式转换；预置他方市场。
- `settings.json`(agent) / monitors / themes / output-styles / lsp / workflows / channels /
  `dependencies` / `types` 等组件的执行（按「注册但不执行」出诊断）。
- 命令级工具收窄与模型覆盖（`commands` 的 `allowed-tools` / `model` / `skills`）。
- 非 command 型 hook（http / mcp_tool / prompt / agent）。
- 插件间依赖解析（`dependencies` 出诊断忽略）。
- `bin/` 的 Windows 语义（先 Unix）。

## 二、已锁定的决策

1. **格式锚点**：以 Claude Code 插件格式的形状为准，清单落在 ucode 自己的 `.ucode-plugin/plugin.json`。
2. **清单三档识别**：`.ucode-plugin` → `.zcode-plugin` → `.claude-plugin`，第一个命中生效；
   同包多清单并存取第一个、其余记诊断，不报错。市场目录同理（`marketplace.json`）。
3. **不读他方目录、不做转换**：不扫 `~/.claude` / `~/.zcode`；读的是插件包内部清单，就地解析。
4. **插件根**：用户级 `$APP_HOME/plugins/`；项目级 `<cwd>/.ucode/plugins/`，**需显式启用**。
5. **v1 组件**：skills / commands / agents / hooks / bin / MCP；pi TS 扩展作为 ucode 专属扩展点。
6. **命名**：界面/引用显示名 `<plugin>:<name>`；pi 底层 token `<plugin>-<name>`（合法字符集）。
7. **可执行性**：hooks 子进程与 pi TS 扩展都允许；TS 扩展逐插件信任。
8. **bin/**：不改工具链路，走 pi `SettingsManager` 的 `shellCommandPrefix` 追加 PATH。
9. **变量**：canonical `${UCODE_PLUGIN_ROOT}`，兼容 `${CLAUDE_PLUGIN_ROOT}` / `${ZCODE_PLUGIN_ROOT}`。
10. **MCP 命名**：服务器名 `plugin_<plugin>_<server>`，工具名对齐 `mcp__plugin_<plugin>_<server>__<tool>`。
11. **市场**：ucode 自己添加来源（github / git / url / npm / 本地目录），不预置他方市场。
12. **状态**：`$APP_HOME/app/plugins.json`；项目级 `<cwd>/.ucode/plugins.json`。
13. **agent 模型别名**：`sonnet` / `opus` / `haiku` / `inherit` 不识别时忽略、回落会话默认模型。
14. **移植友好兼容**：变量别名与 MCP 工具名对齐，使移植插件时 hook matcher 与文档引用不用改。

## 三、插件格式

### 3.1 目录

```
my-plugin/
├── .ucode-plugin/plugin.json   # 唯一清单；也识别 .zcode-plugin / .claude-plugin 下的同名文件
├── skills/<name>/SKILL.md
├── commands/*.md
├── agents/*.md
├── hooks/hooks.json
├── bin/<executable>
├── extensions/                 # pi TS 扩展（ucode 专属，可选）
└── .mcp.json
```

### 3.2 清单字段

v1 支持的键（与 Claude/ZCode 同名同义）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 必填，`^[a-z0-9][a-z0-9._-]{0,127}$`，命名空间与身份 |
| `displayName` | string | 界面显示名，缺省用 `name` |
| `version` | string | 版本，缺省 `0.0.0` |
| `description` | string | 一行说明 |
| `author` | string \| `{name,email?,url?}` | 作者 |
| `homepage` / `repository` / `license` / `keywords` | string / string[] | 元数据 |
| `skills` | path \| path[] | **叠加**默认 `skills/` |
| `commands` | path \| path[] \| object | **替换**默认 `commands/`；object 支持内联 `content` |
| `agents` | path \| path[] | **替换**默认 `agents/` |
| `hooks` | path \| object \| array | 与 `hooks/hooks.json` **合并** |
| `mcpServers` | path \| object \| array | 与 `.mcp.json` **合并** |
| `extensions` | path \| path[] | pi TS 扩展，**叠加**默认 `extensions/` |
| `userConfig` | object | 需要用户填写的配置项 |

**注册但不执行**（识别、出诊断、不影响其它组件）：`settings`、`channels`、`lspServers`、
`outputStyles`、`workflows`、`experimental`、`dependencies`、`types`。
未知顶层键剥离并告警。

### 3.3 路径规则

- 相对插件根，必须以 `./` 开头（`skills` 另接受 `"."` 指插件根）。
- 必须落在插件根内；含 `..` 或越界一律拒绝该组件并出诊断。
- 路径不存在同样拒绝并诊断。

### 3.4 变量

| 变量 | 解析为 | 兼容别名 |
| --- | --- | --- |
| `${UCODE_PLUGIN_ROOT}` | 插件安装目录绝对路径 | `${CLAUDE_PLUGIN_ROOT}`、`${ZCODE_PLUGIN_ROOT}` |
| `${UCODE_PLUGIN_DATA}` | `$APP_HOME/app/plugins/data/<plugin>`，首次引用时创建 | `${CLAUDE_PLUGIN_DATA}` |
| `${UCODE_PROJECT_DIR}` | 会话 cwd | `${CLAUDE_PROJECT_DIR}` |
| `${user_config.KEY}` | `userConfig` 的已存值 | — |

解析字段：hook 的 `command` / `args`、MCP 的 `command` / `args` / `env` / `url` / `headers`、
skill / command / agent 的 Markdown 正文（仅非敏感值）。shell 形式的 hook `command` 与 MCP
`headersHelper` 拒绝 `${user_config.*}`（值会被 shell 再解析）。

### 3.5 市场清单 `marketplace.json`

```json
{
  "name": "my-market",
  "description": "…",
  "pluginRoot": "plugins",
  "plugins": [
    { "name": "hello", "source": "./hello", "version": "1.0.0", "category": "demo", "tags": ["…"] },
    { "name": "from-github", "source": { "source": "github", "repo": "owner/repo", "path": "p", "ref": "main" } }
  ]
}
```

`source` 形式：相对路径字符串 / `{source:"directory",path}` / `{source:"github",repo,path?,ref?}` /
`{source:"git",url,path?,ref?}` / `{source:"url",url,headers?}` / `{source:"npm",package}`。

### 3.6 组件格式

- **skills**：`skills/<name>/SKILL.md`，frontmatter `name` / `description` /
  `disable-model-invocation`，与 pi Agent Skills 规范一致。
- **commands**：`commands/*.md`，frontmatter `description` / `argument-hint`，正文支持 pi 的
  `$ARGUMENTS` / `$1` / `${1:-默认}` 替换。
- **agents**：`agents/*.md`，frontmatter `name` / `description` / `model` / `tools` /
  `disallowedTools`，正文是系统提示词。
- **hooks**：`hooks/hooks.json`，顶层 `"hooks"` 包裹事件表；事件 `SessionStart` /
  `UserPromptSubmit` / `PreToolUse` / `PermissionRequest` / `PostToolUse` / `PostToolUseFailure` /
  `Stop`；handler `type: "command"`（shell 字符串）或 `"process"`（argv），字段 `command` /
  `args` / `env` / `timeout` / `async` / `statusMessage`。
- **MCP**：`.mcp.json` 的 `mcpServers` 映射，条目 `type: stdio|http|sse` + `command` / `args` /
  `env` / `cwd` / `url` / `headers` / `enabled`。
- **bin**：`bin/` 下的可执行文件，启用插件期间进入会话 bash 的 PATH。

## 四、兼容边界与降级清单

| 项 | ucode 处理 |
| --- | --- |
| 清单三档位置 | 支持；多清单并存取第一个，其余诊断 |
| Claude 的 `settings` / `channels` / `lspServers` / `outputStyles` / `workflows` / `experimental` | 注册但不执行，诊断 |
| `dependencies`（跨市场依赖） | 诊断忽略 |
| `commands` 的 `allowed-tools` / `model` / `skills` | 诊断忽略（当普通命令） |
| `agents` 的 `effort` / `maxTurns` / `memory` / `background` / `isolation` / `color` | 诊断忽略 |
| `agents` 的 `model` 别名（sonnet/opus/haiku/inherit） | 忽略，回落会话默认模型 |
| hook 的 `http` / `mcp_tool` / `prompt` / `agent` 型 handler | 诊断忽略 |
| `PermissionRequest` 事件 | pi 无独立权限事件，v1 不实现（诊断） |
| 冒号命名 | 仅显示层；插件正文里的 `/plugin:name` 不会被 pi 展开（已知限制） |
| `bin/` 的 Windows 语义 | v1 按 Unix 处理 |

## 五、架构与代码接缝

### 5.1 模块

新增 `server/src/agent/plugins/`：

| 文件 | 职责 |
| --- | --- |
| `manifest.ts` | 三档定位清单、路径规则、字段校验，产出规范化描述 |
| `market.ts` | 解析 `marketplace.json`、来源解析与拉取（github/git/url/npm/本地） |
| `registry.ts` | 扫描插件根 + 读 `plugins.json` 状态，产出「已启用插件描述」 |
| `sanitize.ts` | 插件 / 组件名 → 显示名与底层 token，跨插件去重 |
| `adapters/skills.ts` | 申报技能路径与改名 |
| `adapters/commands.ts` | 申报命令路径与改名 |
| `adapters/agents.ts` | Claude frontmatter → ucode 角色（工具名映射、能力收敛） |
| `adapters/hooks.ts` | hooks 解析、事件映射、子进程执行 |
| `adapters/mcp.ts` | MCP 合并、变量替换、`registerMcpServer` |
| `adapters/bin.ts` | 计算 bin 目录并生成 `shellCommandPrefix` |
| `extension.ts` | 装配一个内联 pi 扩展：`resources_discover` + 注册 MCP + 注册 hooks |
| `index.ts` | 对外 API：列举、装配输入、状态读写 |

### 5.2 会话装配注入

- `agent/session-config.ts` 的 `createSessionLoader`：
  - `extensionFactories` 增加 `createPluginsExtension(pluginContext)`。
  - 该扩展在 `resources_discover` 里返回插件 skills / prompts 路径；
    `session_start` 后 `registerMcpServer` 注册插件 MCP；装载时 `pi.on` 注册 hook 事件。
  - `extensions`（清单键或目录）走 loader 的 `additionalExtensionPaths`，仅信任的插件。
- `agent/session-config.ts` 的 `buildSessionOptions`：
  - `settingsManager.applyOverrides({ shellCommandPrefix })` 追加插件 `bin/` PATH
    （在 `reload()` 之后，与现有 `defaultTools` 覆盖同一处）。
- 资源改名（`<plugin>:<name>` → `<plugin>-<name>`）通过 loader 的 `skillsOverride` /
  `promptsOverride` 完成；角色注册表在 `agent/agents` 加载后合并插件子角色。
- `agent/assets` 的 `/` 菜单列举复用同一份插件解析结果，透出 `displayName` / `plugin` / `invoke`。

### 5.3 生效与失效

- 计算「启用集指纹」= 排序后的启用插件 id + version（用户级 + 项目级）。
- 会话池记录每个会话装配时的指纹；安装 / 卸载 / 启停 / 更新后，指纹变化的会话被回收，
  下次访问重建。
- 插件解析结果缓存 key = 指纹 + cwd，避免每会话重复扫盘。

## 六、组件适配细则

### 6.1 skills / commands

- 底层名：`<pluginToken>-<componentToken>`；显示名：`<manifest.name>:<componentName>`。
- commands 的 object 内联定义与子目录扁平化（`commands/db/migrate.md` → `plugin:db:migrate`
  显示名、扁平化为一个合法 token）。
- 只透传 pi 认的 `description` / `argument-hint` / 正文；其余 frontmatter 字段出诊断。

### 6.2 agents

Claude agent frontmatter → ucode 角色：

| Claude 字段 | ucode 处理 |
| --- | --- |
| `name` | 显示名与 slug 来源（加插件前缀） |
| `description` | 直接映射 |
| `model` | 别名忽略，回落默认；其余原样交给 `resolveModelRef` |
| `tools` | 经工具名映射表收敛为白名单；未知项诊断丢弃 |
| `disallowedTools` | 收敛为 `excludeTools`（需给 ucode 角色能力补该字段） |
| 其余 | 诊断忽略 |

工具名映射（Claude → pi）：

```
Bash→bash  Read→read  Edit→edit  Write→write  Glob→find  Grep→grep  LS→ls
WebFetch→webfetch  WebSearch→websearch  Task→subagent
```

插件 agents 一律按 subagent 落位（Claude 插件不定义主模式角色），slug 用
`<pluginToken>-<agentToken>`，仍需满足 ucode 的 slug 规则与长度上限。

### 6.3 hooks

事件映射：

| Claude/ZCode | pi 事件 | 决策落点 |
| --- | --- | --- |
| SessionStart | `session_start` | 首轮上下文注入（advisory） |
| UserPromptSubmit | `input` / `before_agent_start` | 可 transform 文本 / 追加上下文 |
| PreToolUse | `tool_call` | 可收紧：`{block, reason}` |
| PermissionRequest | —（v1 不实现） | — |
| PostToolUse | `tool_result` | 可替换结果内容 |
| PostToolUseFailure | `tool_result`（`isError`） | 可注释错误 |
| Stop | `agent_end` / `agent_settled` | 仅通知 / 清理 |

执行口径：

- stdin 收一行 JSON，字段模仿 Claude（`hook_event_name` / `tool_name` / `tool_input` /
  `tool_response` / `prompt` / `cwd` / `session_id` 等）。
- stdout 可选 JSON（`decision` / `reason` / `hookSpecificOutput.additionalContext` 等）；
  exit 2 视为阻断（stderr 作 reason），其它非 0 记日志不阻断。
- `matcher` 对工具名做正则匹配；`timeout` 默认 60s；`async: true` 只对通知类事件生效。
- 环境变量：`UCODE_PLUGIN_ROOT` / `UCODE_PLUGIN_DATA` / `UCODE_PROJECT_DIR` /
  `UCODE_PLUGIN_OPTION_<KEY>`，并兼容 `CLAUDE_*` / `ZCODE_*` 别名。
- **安全边界**：hook 只能收紧、不能放宽 ucode 权限引擎。`PreToolUse` 的 block 与权限扩展的
  deny 取并集；注册顺序保证权限扩展先判定。放宽型 `permissionDecision: allow` 仅对本来
  `ask` 的调用生效，对 `deny` 无效。

### 6.4 MCP

- 读 `.mcp.json` 与清单 `mcpServers`，做变量替换后 `pi.registerMcpServer(name, config)` 注册。
- `name = plugin_<pluginToken>_<server>`；显示层为 `plugin:<plugin>:<server>`，设置页只读分组
  「插件 MCP」。
- 与用户自己的 `$APP_HOME/agent/mcp.json` 分组展示；同名以用户配置优先（出诊断）。

### 6.5 bin

- 会话装配时收集启用插件的 `bin/` 目录（存在且含可执行文件）。
- `shellCommandPrefix` = `export PATH="$PATH:<dir1>:<dir2>"` + 换行；路径含空格做 shell 转义。
- **追加在 `$PATH` 之后**，不遮蔽系统命令；只作用于会话 bash 工具，不改 server 进程 PATH。

### 6.6 pi TS 扩展

- 清单 `extensions` 键或默认 `extensions/` 目录，走 loader 的 `additionalExtensionPaths`。
- 逐插件信任：未在 `plugins.json` 的 `trustedExtensions` 中的插件不加载，出诊断并在设置页提示。
- 在 server 进程内执行，启用即等于授予代码执行信任。

## 七、命名空间与命名规则

```
显示名（UI / 引用）   my-plugin:review
pi 底层 token         my-plugin-review
```

- sanitize：小写；非 `[a-z0-9-]` 替换为 `-`；折叠连续 `-`；去首尾 `-`；数字开头补前缀。
- token = `<pluginToken>-<componentToken>`；跨插件冲突时追加 `-<6位hash>`。
- 插件 agents 的 slug 需满足 ucode 规则（小写字母开头、`[a-z0-9-]`、长度上限）。
- MCP 服务器名用下划线形式 `plugin_<plugin>_<server>`（与 Claude 工具名前缀对齐）。

## 八、市场与安装

### 8.1 目录布局

```
$APP_HOME/plugins/
├── marketplaces/<market>/        # 市场仓库 clone / 解包
└── cache/<pluginId>/             # 安装后的插件副本（本地源可登记原路径）
$APP_HOME/app/plugins/data/<plugin>/   # ${UCODE_PLUGIN_DATA}
```

### 8.2 状态文件 `plugins.json`

```json
{
  "marketplaces": [{ "name": "my-market", "source": { "…": "…" } }],
  "installed": [
    { "id": "my-market/hello", "name": "hello", "version": "1.0.0", "path": "…", "enabled": true }
  ],
  "config": { "my-market/hello": { "api_key": "…" } },
  "trustedExtensions": ["my-market/hello"]
}
```

项目级 `<cwd>/.ucode/plugins.json` 只承载启用覆盖：

```json
{ "enabled": ["my-market/hello"] }
```

**项目级插件默认不启用**，必须显式写入该文件或在设置页开启。

### 8.3 安装流程

1. 解析来源 → 拉取到 `marketplaces/` 或 `cache/`（github/git clone、url 下载、npm 解包、
   本地目录登记）。
2. 定位清单（三档），校验字段与组件路径。
3. 写入 `plugins.json`，默认启用；返回插件视图。
4. 更新：市场条目 `version` 与插件 `plugin.json` `version` 对比；不一致提示可更新。

## 九、契约与接口

### 9.1 契约（`packages/contracts/src/plugins/`）

- `input.ts`：`pluginsListInputSchema`、`marketplaceAddInputSchema`、`marketplaceRemoveInputSchema`、
  `marketplaceRefreshInputSchema`、`pluginInstallInputSchema`、`pluginUninstallInputSchema`、
  `pluginSetEnabledInputSchema`、`pluginConfigureInputSchema`。
- `output.ts`：`PluginView`（`id` / `name` / `displayName` / `version` / `description` / `source` /
  `enabled` / `components`）、`PluginMarketplaceView`、`PluginListResponse`、`PluginComponentView`
  （`kind` / `name` / `displayName` / `count`）。
- 既有契约扩展：`CommandAssetSource` 增 `"plugin"`；`PromptCommandView` / `SkillCommandView` 增
  `displayName` / `plugin?` / `invoke`；`AgentView` 增 `displayName?` / `plugin?`。
- `envelope.ts` 新错误码：`plugin_not_found`、`plugin_manifest_invalid`、`plugin_component_invalid`、
  `marketplace_invalid`、`plugin_source_invalid`、`plugin_install_failed`、`plugin_requires_trust`。

### 9.2 路由（`server/src/routes/plugins/`）

```
POST /api/v1/plugins/list
POST /api/v1/plugins/marketplace/add | remove | refresh
POST /api/v1/plugins/install | uninstall | enable | disable | configure
```

出参统一 `ok()` / `fail()`；响应生产点显式标注契约类型。

### 9.3 SDK / i18n

- `@ucode/sdk` 增 `plugins` 域 store（列举、安装、启停、配置）。
- `packages/i18n` 补错误码文案与设置页文案（中英齐平）。

## 十、前端

- 设置页新增 **Plugins** 分页：市场列表、插件列表与详情（组件列表）、安装 / 卸载 / 启停 /
  配置 `userConfig`、TS 扩展信任开关、刷新与更新提示。
- `/` 菜单：插件提供的命令与技能并入现有分组，带插件来源标识；`invoke` 用底层 token 序列化。
- agent 选择器：插件子角色带 `<plugin>:<name>` 展示。
- 已启用但加载失败的插件展示诊断原因。

## 十一、信任与安全

- 安装与启用均需显式操作；启用前展示插件将执行的内容（hooks / MCP / bin / TS 扩展）。
- 项目级插件默认不启用，避免 clone 即执行代码。
- TS 扩展逐插件信任；未信任不加载。
- hooks / MCP / bin 都以 server 权限运行，文档与 UI 明确提示。
- 与 `TODO.md` P0（`/api/v1` 无鉴权、默认监听所有网卡）联动：插件管理接口纳入同一安全整改，
  整改前不要把服务暴露到不可信网络。

## 十二、测试方案

server 侧 `node:test`，放同级 `__tests__/`。

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| PLG-01 | 三档清单定位与并存 | 取第一个，其余记诊断 |
| PLG-02 | 路径规则 | `./` 前缀、越界 / `..` / 不存在拒绝并诊断 |
| PLG-03 | 不支持字段 | 注册但不执行，出诊断，其它组件正常 |
| PLG-04 | sanitize / 命名 | 显示名与底层 token 正确，跨插件冲突加 hash |
| PLG-05 | skills / commands 改名 | `skillsOverride` / `promptsOverride` 后名称正确 |
| PLG-06 | agent frontmatter 翻译 | 工具名映射、`disallowedTools`、model 别名回落 |
| PLG-07 | hook 事件映射 | PreToolUse block、PostToolUse 改内容、exit 2 语义 |
| PLG-08 | MCP 变量替换与命名 | 服务器名 `plugin_<plugin>_<server>`，变量解析正确 |
| PLG-09 | bin PATH | `shellCommandPrefix` 追加在 `$PATH` 之后 |
| PLG-10 | 市场解析 | 各来源形式解析正确；版本对比 |
| PLG-11 | 状态读写 | `plugins.json` 增删改与项目级启用覆盖 |
| PLG-12 | 会话失效 | 启用集指纹变化后会话被回收重建 |

L4 / L5：`pnpm smoke` 加一条「启用含 skill 的插件后模型可调用」；浏览器走查设置页安装 / 启停、
`/` 菜单插件项、插件子角色选择。

## 十三、验收

- 三种清单位置都能被识别；不支持字段出诊断且不影响其它组件。
- skills / commands / agents 正确透出到 `/` 菜单与选择器，命名符合显示名与底层 token 约定。
- hooks 在对应事件触发，PreToolUse 可阻断；MCP 服务器连接且工具名与 Claude 对齐；bin 进入 PATH。
- 市场可添加 / 移除 / 刷新，插件可安装 / 卸载 / 启停 / 配置；项目级插件需显式启用。
- 启停后相关会话按新启用集重建。
- `pnpm check` 全绿；`docs/api.md` 与契约一致。

## 十四、风险与边界

- **代码执行**：hooks / MCP / TS 扩展 / bin 都以 server 权限运行，信任模型必须到位。
- **无鉴权**：与 P0 联动，整改前不得暴露。
- **兼容降级**：冒号命名、命令级工具收窄、非 command 型 hook、agent model 别名等为降级项，
  需在 `docs/plugins.md` 的兼容表说明。
- **插件热更**：会话池长驻，必须按指纹失效，否则插件变更对旧会话不可见。
- **`userConfig` 密钥**：v1 明文存 `plugins.json`（0600），后续再做安全存储。

## 十五、落地顺序

1. 契约（`plugins/` 域 + 既有视图扩展 + 错误码 + i18n）+ `plugins.json` 状态 +
   `agent/plugins/` 骨架（manifest / registry / sanitize）+ 单测。
2. `resources_discover` 扩展 + skills / commands / agents 适配 + `/` 菜单与选择器透出。
3. MCP 注册 + hooks 桥接。
4. bin/（`shellCommandPrefix`）。
5. 市场安装 / 更新 + 设置页 UI + 会话失效重建。
6. pi TS 扩展 + 信任模型 + `docs/plugins.md` + `CHANGELOG.md`。
7. `pnpm check` + `pnpm build` + `agent-browser` 走查 + `pnpm smoke`，停下等 review。

## 十六、后续路线

- 命令级能力（`allowed-tools` / `model` / `skills`）与 `PermissionRequest` 事件。
- 非 command 型 hook（http / mcp_tool / prompt / agent）。
- 插件间 `dependencies` 与跨市场依赖。
- 支持组件：`output-styles` / `themes` / `monitors` / `lsp` / `workflows`。
- `userConfig` 敏感值的安全存储。
- 与 Claude Code / ZCode 市场的互操作（导入导出，而非运行期读取）。

## 十七、复盘

> 待落地后补。
