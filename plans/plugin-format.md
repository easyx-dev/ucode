# 插件格式与兼容（方案）

> 状态：**架构定稿，未实施**。所属平台（宿主 API、接缝、信任模型）见 [`plugins.md`](./plugins.md)；
> 来源与版本见 [`plugin-market.md`](./plugin-market.md)。
>
> 核心目标是**兼容是重点、不是降级项**：一个按 Claude Code 或 ZCode 规范写的插件，放进 ucode 的
> 插件根就能用；移植时不需要改 hook matcher、不需要改文档里的变量引用。

## 一、包结构

```
my-plugin/
├── .<slug>-plugin/plugin.json   # 唯一清单；也识别 .zcode-plugin / .claude-plugin 下的同名文件
├── skills/<name>/SKILL.md
├── commands/*.md
├── agents/*.md
├── hooks/hooks.json
├── bin/<executable>
├── extensions/                   # pi TS 扩展（ucode 专属，可选）
└── .mcp.json
```

`<slug>` 与清单目录名都从 `packages/brand/src/brand.ts` 的 `brand.slug` 派生（品牌校验会拦下
`server/src` 里的硬编码品牌名，见 `packages/brand/scripts/verify.ts:100-113`）。三档识别顺序：
当前品牌 → `.zcode-plugin` → `.claude-plugin`，第一个命中生效；同包多清单并存取第一个、其余记诊断。

## 二、清单字段

与 Claude / ZCode 同名同义：

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
未知顶层键剥离并告警，不报错。

## 三、ucode 专属键

这些键是平台能力（模式、界面、动作、能力声明）。Claude / ZCode 侧忽略未知键，因此**加了它们不破坏
兼容**；反过来，只有 Claude 键的插件在 ucode 里按第六节的能力子集运行。

形状示例（字段细节以实施时的契约为准）：

```json
{
  "apiVersion": 1,
  "capabilities": ["storage", "events", "modes"],
  "modes": [
    {
      "name": "audit",
      "displayName": "审计",
      "description": "只读审查，产出问题清单",
      "icon": "search",
      "tools": { "exclude": ["write", "edit"] },
      "permissions": {
        "approvalMode": "default",
        "rules": [{ "tool": "write", "action": "deny" }]
      },
      "thinkingLevel": "medium",
      "prompt": "./prompts/audit.md"
    }
  ],
  "slots": [
    {
      "slot": "session-header",
      "id": "audit-status",
      "when": { "mode": "audit" },
      "render": { "kind": "status", "text": "审计中" }
    }
  ],
  "actions": [{ "id": "scan", "title": "扫描", "input": "./schemas/scan.json" }],
  "sessionHooks": ["onTurnSettled"],
  "storage": ["session"],
  "events": ["audit_progress"]
}
```

| 键 | 语义 | 约束 |
| --- | --- | --- |
| `apiVersion` | 宿主 API 版本 | 不匹配**拒绝加载并出诊断**（不做静默降级） |
| `capabilities` | 需要的能力 | 与宿主 API 组一一对应；未声明的调用运行期被拒；升级新增要重新确认 |
| `modes` | 定义主模式 | 工具集只能在内核默认集内收敛；权限规则只收紧；档位不得默认 `full` |
| `slots` | 界面贡献（声明式） | slot id 见 [`plugins.md`](./plugins.md) 5.2；第三方不给 `componentId` |
| `actions` | 可调用动作 | 经 `plugins/invoke`；请求校验用自带的 schema 文件 |
| `sessionHooks` | 订阅的会话钩子 | 与 `capabilities` 一致才生效 |
| `storage` / `events` | 存储与事件作用域 | 运行期按声明校验 |

## 四、路径规则

- 相对插件根，必须以 `./` 开头（`skills` 另接受 `"."` 指插件根）。
- 必须落在插件根内；含 `..` 或越界一律拒绝该组件并出诊断。
- 路径不存在同样拒绝并诊断。
- 校验复用（不另写第四份）：`server/src/platform/paths/index.ts` 与 `harness/features/context` 的 realpath + 前缀判定
  上提后的公共实现。

## 五、变量

| 变量 | 解析为 | 兼容别名 |
| --- | --- | --- |
| `${<品牌大写>_PLUGIN_ROOT}` | 插件安装目录绝对路径 | `${CLAUDE_PLUGIN_ROOT}`、`${ZCODE_PLUGIN_ROOT}` |
| `${<品牌大写>_PLUGIN_DATA}` | `$APP_HOME/app/plugins/data/<plugin>`，首次引用时创建 | `${CLAUDE_PLUGIN_DATA}` |
| `${<品牌大写>_PROJECT_DIR}` | 会话 cwd | `${CLAUDE_PROJECT_DIR}` |
| `${user_config.KEY}` | `userConfig` 的已存值 | — |

变量名前缀由 `brand.slug` 派生（`server/src` 里不得出现硬编码品牌名字面量）。解析字段：hook 的
`command` / `args`、MCP 的 `command` / `args` / `env` / `url` / `headers`、skill / command / agent
的 Markdown 正文（仅非敏感值）。shell 形式的 hook `command` 与 MCP `headersHelper` **拒绝**
`${user_config.*}`（值会被 shell 再解析）。

## 六、组件格式与适配

### 6.1 skills / commands

- 底层名 `<pluginToken>-<componentToken>`，显示名 `<plugin>:<componentName>`。
- 加载走**装配期**注入：`additionalSkillPaths` / `additionalPromptTemplatePaths`（`server/src/harness/setup/session-config.ts:186-189`），
  改名走 loader 的 `skillsOverride` / `promptsOverride`——后者与既有的内置命令 override 组合，
  不得覆盖 `withBuiltinPrompts`（`harness/setup/assets/index.ts:65`）。
- commands 的 object 内联定义与子目录扁平化（`commands/db/migrate.md` → 显示名
  `<plugin>:db:migrate`，底层 token 扁平化）。
- 只透传 pi 认的 `description` / `argument-hint` / 正文，其余 frontmatter 出诊断。

### 6.2 agents

`agents/*.md` 的 frontmatter 走 Claude 语义：

| Claude 字段 | ucode 处理 |
| --- | --- |
| `name` | 显示名与 slug 来源（加插件前缀） |
| `description` | 直接映射 |
| `model` | 别名 `sonnet` / `opus` / `haiku` / `inherit` 忽略并回落会话默认；其余交给 `resolveModelRef` |
| `tools` | 经工具名映射表收敛为白名单；未知项诊断丢弃 |
| `disallowedTools` | 收敛为 `excludeTools`（需给 ucode 角色能力补该字段） |
| 其余（`effort` / `maxTurns` / `memory` / `background` / `isolation` / `color`） | 诊断忽略 |

工具名映射（Claude → pi）：

```
Bash→bash  Read→read  Edit→edit  Write→write  Glob→find  Grep→grep  LS→ls
WebFetch→webfetch  WebSearch→websearch  Task→subagent
```

有 `mode: <slug>` 的 agent 进主模式注册表（与清单的 `modes` 键合并，同一 slug 冲突时以 `modes` 为准）；
其余按子角色落位，slug 用 `<pluginToken>-<agentToken>`，需满足 ucode 的 slug 规则与长度上限。

### 6.3 hooks

事件映射：

| Claude / ZCode | pi 事件 | 决策落点 |
| --- | --- | --- |
| SessionStart | `session_start` | 首轮上下文注入（advisory） |
| UserPromptSubmit | `input` + `before_agent_start` | `input` 只能 `transform` 文本；追加上下文走 `before_agent_start` 的 `message` |
| PreToolUse | `tool_call` | 可收紧：`{block, reason}` |
| PermissionRequest | —（不实现，出诊断） | pi 无独立权限事件 |
| PostToolUse | `tool_result` | 可替换结果内容 |
| PostToolUseFailure | `tool_result`（`isError`） | 可注释错误 |
| Stop | `agent_end` / `agent_settled` | 仅通知 / 清理 |

执行口径：

- stdin 一行 JSON，字段模仿 Claude（`hook_event_name` / `tool_name` / `tool_input` /
  `tool_response` / `prompt` / `cwd` / `session_id` 等）。
- stdout 可选 JSON（`decision` / `reason` / `hookSpecificOutput.additionalContext` 等）；
  exit 2 视为阻断（stderr 作 reason），其它非 0 记日志不阻断。
- `matcher` 对工具名做正则匹配；`timeout` 默认 60s；`async: true` 只对通知类事件生效。
- 环境变量：派生的 `*_PLUGIN_ROOT` / `*_PLUGIN_DATA` / `*_PROJECT_DIR` /
  `*_PLUGIN_OPTION_<KEY>`，并设 `CLAUDE_*` / `ZCODE_*` 别名。
- **安全边界**：hook 只能收紧。`PreToolUse` 的 block 与权限扩展的 `deny` 取并集；注册顺序保证
  权限扩展先判定（`extensionFactories` 数组顺序即加载顺序，`session-config.ts:189`）。放宽型
  `permissionDecision: allow` 仅对本来 `ask` 的调用生效，对 `deny` 无效。
- 非 command 型 handler（`http` / `mcp_tool` / `prompt` / `agent`）出诊断忽略。

### 6.4 MCP

- 读 `.mcp.json` 与清单 `mcpServers`，变量替换后**合并进现有 MCP 扩展的 `loadConfig`**
  （`harness/setup/mcp/index.ts:29`），不走 `pi.registerMcpServer`（现状未用该 API）。
- 服务器名 `plugin_<pluginToken>_<server>`，工具名对齐 `mcp__plugin_<pluginToken>_<server>__<tool>`。
- 与用户自己的 `$APP_HOME/harness/mcp.json` 分组展示；同名以用户配置优先（出诊断）。
- 插件 MCP 仍只给「默认工具集」的会话（沿用现状边界：MCP 会激活 codemode，绕过只读白名单）。

### 6.5 bin

- 收集启用插件的 `bin/` 目录（存在且含可执行文件）。
- 注入会话 bash 的 **spawn env**：`PATH` 追加在末尾，用 `path.delimiter`，不遮蔽系统命令，
  不改 server 进程 PATH（自研 shell 扩展已覆盖内置 bash，`shellCommandPrefix` 不生效，
  见 `harness/features/shell/index.ts:1-8`）。
- 平台语义（Windows 的可执行后缀与 PATH 分隔符）在实施时明确并写进测试。

### 6.6 pi TS 扩展

- 清单 `extensions` 键或默认 `extensions/` 目录，走 loader 的 `additionalExtensionPaths`。
- **逐插件信任**：未在 `plugins.json` 的 `trustedExtensions` 里的插件不加载，出诊断并在设置页提示。
- 在 server 进程内执行；启用即等于授予代码执行信任。
- 顺带定策：关掉 `<agentDir>/extensions`（`$APP_HOME/harness/extensions`）的隐式自动加载
  （会话 loader 现在没设 `noExtensions`），否则旁路信任模型；行为变更记 `CHANGELOG`。

## 七、兼容边界与降级清单

| 项 | ucode 处理 |
| --- | --- |
| 清单三档位置 | 支持；多清单并存取第一个，其余诊断 |
| `settings` / `channels` / `lspServers` / `outputStyles` / `workflows` / `experimental` | 注册但不执行，诊断 |
| `dependencies`（跨市场依赖） | 诊断忽略 |
| `commands` 的 `allowed-tools` / `model` / `skills` | 诊断忽略（当普通命令） |
| hook 的 `http` / `mcp_tool` / `prompt` / `agent` 型 handler | 诊断忽略 |
| `PermissionRequest` 事件 | 不实现（诊断） |
| 冒号命名 | 仅显示层；插件正文里的 `/plugin:name` 不会被 pi 展开（已知限制） |
| `bin/` 的 Windows 语义 | 实施时明确，不留「先 Unix」的含糊 |
| 只给 Claude 键的插件 | 资源型能力全可用；模式 / 插槽 / 动作等 ucode 专属能力不出现 |

## 八、命名空间与命名规则

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

## 九、能力声明与信任（清单视角）

| 声明 | 含义 | 信任要求 |
| --- | --- | --- |
| 资源型组件（skills / commands / agents / MCP / bin） | 文件与配置 | 启用即生效；bin / MCP 在 UI 上标明「以服务权限运行」 |
| `hooks` / `extensions` / `tools` / `sessionHooks` | 执行代码 | 逐插件信任 |
| `modes` / `slots` / `actions` / `events` / `storage` | 平台能力 | 启用时授权，落 `plugins.json` 的 grants |

项目级插件默认不启用；启用前展示将执行的内容；升级引入新能力要重新确认。

## 十、测试与夹具

- **兼容夹具**：`server/src/harness/plugins/__tests__/fixtures/` 放真实 Claude Code 与 ZCode 插件的
  目录形状（三档清单各一例、含 `settings` / `channels` 等不支持键、含 hooks / `.mcp.json` / agents），
  逐条验证「识别正确 + 诊断正确 + 其它组件不受影响」。
- 单元用例编号与覆盖见 [`plugins.md`](./plugins.md) 第十三节（PLG-01 ~ PLG-18）。
- 不引入第三方测试框架，断言用 `node:assert/strict`。
