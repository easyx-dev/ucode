# 模式与权限

本文是「助手模式」与「权限」的单一事实源：讲清会话能做什么（工具集）、什么时候必须停下来问人（审批），
以及两者如何在一次工具调用上叠加。实现落位见各节引用的代码路径。

## 两层模型

一条工具调用要过两道独立的闸门：

1. **准入（会话模式）**：`build` / `plan` / `ask` 或自定义 primary agent 决定**工具集**、
   提示词倾向，以及一组 `deny` 规则。只读模式在这里把写盘与执行能力整个拿掉。
2. **审批（会话权限档位）**：`default` / `auto` / `full` 只决定判定结果是 `ask` 时**弹审批还是自动放行**。
   它不改变工具集，也**永远不突破 `deny`**。

所以档位只能「放宽询问」，不能「授予能力」：在只读模式下把档位调到 `full` 也改不了文件、跑不了命令。

## 会话模式

模式是主会话角色（primary agent）的 slug，决定能力三元组（提示词片段 + 工具集 + 权限规则）。
内置三个，声明在 `server/src/agent/agents/profiles.ts`，工具名清单在 `server/src/agent/tools/names.ts`。

| 模式 | 界面文案 | 工具集 | 专属权限规则 | 用途 |
| --- | --- | --- | --- | --- |
| `build` | 编码 | 默认集：`read` / `bash` / `edit` / `write` / `grep` / `find` / `ls` + `codemode` + 自研工具（`webfetch` / `websearch` / `question` / `subagent` / 记忆工具） | 无（只受全局默认规则约束） | 正常编码与执行 |
| `plan` | 计划 | 只读集：`read` / `grep` / `find` / `ls` / `webfetch` / `websearch` / `question` + `present_plan` + `subagent` | `deny` `edit` / `write` / `bash` | 先调研出方案；本轮以 `present_plan` 收尾，前端弹决策表单 |
| `ask` | 问答 | 只读集 + `subagent`（无 `present_plan`） | `deny` `edit` / `write` / `bash` | 只读分析与回答 |

- 只读模式**直接禁 `bash`**，不做「允许但限制路径」——命令里的路径无法可靠解析，那是假约束。
- 自定义 primary agent 可覆盖同名内置项或另取新名；`mode` 是字符串 slug，服务端按角色注册表校验。
- 子智能体是独立的 subagent 角色（`general` / `explore`），能力 =「父会话 ∩ 角色定义」，工具取交集、
  权限取较严者，保证只读父会话不会被委派越权（见 [`plans/stage-7c-subagents.md`](../plans/stage-7c-subagents.md)）。

## 权限引擎

实现：`server/src/agent/permissions/`。规则是声明式的，挂在 pi 的 `tool_call` 拦截上
（`extension.ts` + `DefaultResourceLoader({ extensionFactories })`，装配在 `session-config.ts`）。

### 规则与判定

一条规则 = `{ tool, pattern, action, note? }`：

- `tool`：工具名，`*` 匹配所有；`external_directory` 不是真实工具，是「工作目录之外的路径」这一独立检查项。
- `pattern`：匹配串，`*` 匹配任意字符（含路径分隔符）。路径类工具（`read` / `write` / `edit` / `grep` /
  `find` / `ls`）的匹配对象是**归一化后的绝对路径**，规则不必关心会话工作目录在哪。
- `action`：`allow` 直接放行 / `ask` 交用户确认 / `deny` 阻断。

判定按顺序匹配，**最后命中者胜**；未命中任何规则时默认 `allow`（与 opencode / Claude Code 一致）。

### 默认规则

`permissions/defaults.ts` 里的两条底线，对齐 opencode：

- `.env` / `.env.*` 的 `read` / `write` / `edit` 默认 `deny`，`.env.example` 这类示例文件 `allow`；
- 工作目录之外的路径（`external_directory`）默认 `ask`。

### 越界目录

路径落在会话工作目录之外时，先按工具规则判一次，再按 `external_directory` 判一次，取**更严**的一档
（`allow < ask < deny`）。授权范围按目标**父目录整目录通配**记账（批准 `/etc/hosts` 只记住 `/etc/**`，
不会退化成放行整个工具）。目标本身是根目录时退回自身，避免 `/ **` 变成全盘放行。

### 技能目录

技能目录属于可读资源：模型按技能说明读 `SKILL.md` 及其相对引用文件通常落在工作目录之外。
`skillDirectoryRules()` 为每个技能目录追加一条 `external_directory` 的 `allow`（整棵子树），
排在模式规则之后——只读模式对 `write` / `edit` 的 `deny` 更严，仍会生效。

### MCP 工具

MCP 工具没有命中显式规则时，按服务器声明的 annotations 兜底：`readOnlyHint === true` 默认放行，
其余默认审批。annotations 由 MCP 服务器作者声明、未经校验，所以只信「只读」这一侧；
显式规则与会话恒允照常覆盖（见 [`plans/stage-7a-mcp.md`](../plans/stage-7a-mcp.md)）。

### 审批与「本会话恒允」

命中 `ask` 时挂起并向本会话事件流发一条请求，前端弹权限审批弹窗，三个答复（`PERMISSION_DECISIONS`）：

- `allow_once`：只放行本次；
- `allow_session`：**按判定给出的范围追加一条 `allow` 规则**（规则类 `ask` 用规则串，越界检查用父目录通配），
  之后的同类调用直接命中；
- `deny`：阻断。

超时（`PERMISSION_APPROVAL_TIMEOUT_MS`）与断连按拒绝结算，避免工具调用永久挂起。
「本会话恒允」只存在进程内存，删 / 归档会话时清理，服务重启回到规则默认。

## 权限档位

会话级属性，默认 `default`（`PERMISSION_MODES` / `DEFAULT_PERMISSION_MODE`，落库列 `permission_mode`）。
它只改写最终动作是 `ask` 的情形：

| 档位 | 界面文案 | 常规工具的 `ask` | `external_directory` 的 `ask` | `deny` |
| --- | --- | --- | --- | --- |
| `default` | 默认 | 弹审批 | 弹审批 | 保持阻断 |
| `auto` | 自动批准 | 自动放行 | 弹审批 | 保持阻断 |
| `full` | 完全访问 | 自动放行 | 自动放行 | 保持阻断 |

- `auto` 覆盖内置工具与 MCP 写类工具；`full`（完全访问）连工作目录之外的读取与写入审批也跳过，
  即除 `deny` 外不再有审批弹窗。
- `deny` 在任何档位都不变：`.env` 阻断、只读模式对 `edit` / `write` / `bash` 的阻断都不受档位影响。
- `full` 在输入区用 warning 色标记，提示它已跳过越界审批；选中时不弹二次确认。
- 切换档位与换模型 / 换模式同款处理：生成中拒绝（`409 session_busy`），落库后重建会话实例（`pool.dispose`），
  并用 `session_updated` 事件下发，多端同步。

### 与新建 / 分叉 / 子会话的关系

- **新建会话**恒为 `default`：档位不写进输入区草稿，空态（还没有会话）时选择器禁用。
- **会话分叉**不继承档位：`sessions/fork` 生成的新会话从 `default` 开始。
- **子智能体**继承父会话档位：父在 `auto` / `full` 时，委派出的子会话沿用同一档位，不退回默认。
  该继承发生在**子会话创建时**，之后不再跟随父会话变化——父会话收紧档位时，已创建（含续跑）的子会话
  仍按创建时的档位运行。

## 安全边界

- 本仓库**没有 OS 级沙箱**：`cwd` 与工具白名单都不是安全边界（pi 的 `security.md` 明示 cwd 不阻止命令访问其他路径）。
  对外只承诺「**只读工具集**」，不承诺「只读权限」。
- `deny` 只是应用层拦截，不是内核约束；档位与「恒允」都只能在这个层内放宽 `ask`。
- 服务默认无 HTTP 鉴权且监听所有网卡，背后的 agent 带 `read` / `write` / `edit` / `bash` 权限。
  **不要把服务暴露到公网或不可信网络**，见 [`README.md`](../README.md) 的安全提示与 [`TODO.md`](../TODO.md)。
