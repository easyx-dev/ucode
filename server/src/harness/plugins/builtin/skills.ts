/**
 * 内置技能的真身：随包发布、物化到 `$APP_HOME/app/builtin/skills/<id>/`。
 *
 * 正文写成 TS 常量而不是 `.md` 文件，是构建链的取舍而不是图省事：正文里有从品牌派生的产品名、
 * 清单目录名与环境变量前缀（换品牌必须跟着变，不能落成字面量），改成 `.md` 真身要额外解决
 * 三件事——esbuild 的 text loader、开发与测试链路（tsx）对 `.md` 的加载、以及模板占位替换。
 * 现在只有 `docs/plugin-authoring.md` 一个生成物还指着这里（`scripts/plugin-docs`），
 * 单独为它引进这套流水线不划算。真要改时按上述三件事一起做（见 `plans/plugins.md` 复盘）。
 */
import { brand } from "@ucode/brand/values";

/** 本品牌清单目录名：`.<slug>-plugin` */
const MANIFEST_DIRNAME = `.${brand.slug}-plugin`;

/** 环境变量前缀：`<SLUG>_PLUGIN_ROOT` 这类 */
const ENV_PREFIX = brand.slug.toUpperCase();

/** 全局档目录名与项目配置目录名：都是 `.<slug>`，正文里给模型指路用 */
const HOME_DIRNAME = `.${brand.slug}`;

/** 内置技能：文件以插件包内的相对路径为键，`SKILL.md` 必须有 */
export type BuiltinSkill = {
  /** 目录名与技能名 */
  id: string;
  /** 一句话说明，供 `/` 菜单展示 */
  description: string;
  /** 随包版本：内容有实质变化时递增（没变就不重写盘） */
  version: string;
  files: Record<string, string>;
  /** 缺任一项就拒绝物化这个技能（宁可用上一版，也不要半个技能） */
  requiredFiles: readonly string[];
};

const PLUGIN_CREATE_SKILL = `---
name: plugin-create
description: 引导创建一个能被 ${brand.name}、Claude Code 与 ZCode 同时识别的插件包
---

# 创建插件包

目标是让一个目录变成**三端都能装**的插件：本产品读 \`${MANIFEST_DIRNAME}/plugin.json\`，
Claude Code 读 \`.claude-plugin/plugin.json\`，ZCode 读 \`.zcode-plugin/plugin.json\`。
三份清单内容一致时，放进任意一端都能用。

## 1. 最小骨架

\`\`\`
my-plugin/
├── ${MANIFEST_DIRNAME}/plugin.json     # 本产品清单（也可放 .claude-plugin / .zcode-plugin）
├── skills/<name>/SKILL.md        # 技能：模型按 description 选用
├── commands/<name>.md            # 命令：用户用 /<name> 调用
├── agents/<name>.md              # 子角色：由 subagent 工具委派
├── hooks/hooks.json              # 命令式钩子：在工具调用前后跑脚本
├── bin/<executable>              # 加进会话 PATH 的可执行文件
├── .mcp.json                     # MCP 服务器
└── extensions/*.ts               # 本产品专属：pi 扩展（代码型，随包或本地登记才生效）
\`\`\`

清单可以缺省：没有 \`plugin.json\` 时按上面的标准目录布局加载，插件名取目录名。

## 2. 清单字段

| 字段 | 说明 |
| --- | --- |
| \`name\` | 必填，小写字母或数字开头，只含小写字母、数字与 \`.\` \`_\` \`-\`；它是命名空间 |
| \`displayName\` / \`description\` / \`version\` | 展示名、一句话说明、版本（缺省 \`0.0.0\`） |
| \`skills\` / \`commands\` / \`agents\` | 覆盖默认目录；\`skills\` 与 \`extensions\` 是**叠加**，其余是**替换** |
| \`hooks\` / \`mcpServers\` | 与 \`hooks/hooks.json\` / \`.mcp.json\` **合并**；也可直接内联 |
| \`userConfig\` | 需要用户填写的配置项 |

不认识顶层字段只出诊断（信息级别），不影响其它组件；字段类型不符才算坏清单。

## 3. 命名与变量

组件在界面上叫 \`<plugin>:<name>\`，底层 token 是 \`<plugin>-<name>\`；与已占用名字冲突时自动加哈希后缀，
不用自己避让。正文与 hook 命令里可以写：

- \`\${${ENV_PREFIX}_PLUGIN_ROOT}\`：插件安装目录（\`CLAUDE_PLUGIN_ROOT\` / \`ZCODE_PLUGIN_ROOT\` 是别名）
- \`\${${ENV_PREFIX}_PLUGIN_DATA}\`：跨版本保留的插件数据目录
- \`\${${ENV_PREFIX}_PROJECT_DIR}\`：会话工作目录
- \`\${user_config.KEY}\`：\`userConfig\` 里用户填的值

**shell 形式的 hook 命令里不要用 \`\${user_config.*}\`**：值会被 shell 再解析一遍，等于把注入面交给用户输入。

## 4. 安装与调试

1. 打开「设置 → 插件」，在输入框填插件目录的**绝对路径**，点「从目录安装」。
   安装**不复制内容**，改完源文件点「重拉」即可生效。
2. 技能与命令出现在 \`/\` 菜单里（来源标 \`plugin\`）；角色出现在角色选择器里（slug 带插件前缀）。
3. 诊断写在插件卡片里：坏清单、越界路径、不认识的事件或字段都会逐条列出来。

## 5. 常见坑

- **组件路径必须以 \`./\` 开头**，且归一化后仍在插件根内；经符号链接逃出根会被拒绝。
- 技能的两种写法都行：\`skills/<name>/SKILL.md\`（一个目录一个技能），或清单直接指向某个含 \`SKILL.md\` 的目录。
- 前端没有界面插槽：插件不改界面，只贡献资源与代码（扩展）。要展示信息就写进技能正文或命令输出。
- 第三方市场的钩子、扩展与 \`bin/\` **不会注入运行时**（管理员只信任随包与本地登记的插件）；
  开发期请用「从目录安装」自测。
- 清单、角色文件、hooks 都是**宽松解析**：写错一处只跳过那一处并出诊断，不会整包失败；但钩子写错了不会报错，
  只会「看起来没生效」——先在本地目录安装下确认它真的跑了。
`;

const PLUGIN_REVIEW_SKILL = `---
name: plugin-review
description: 审计第三方插件（清单、钩子、bin、MCP、扩展的信任面），输出分级结论
---

# 审计第三方插件

在**启用或安装来自第三方的插件前**跑一遍，把「装即等于把权限交给它」这件事看清楚。
目标是给出可执行的结论，而不是复述清单。

## 0. 先确定审计对象

- 插件目录：\`\${${ENV_PREFIX}_PLUGIN_ROOT}\`（已装）或用户给的路径（未装）。
- 来源：随包 / 本地登记 / 第三方市场。**来源决定执行类组件是否生效**——第三方市场的
  \`hooks\`、\`extensions/\`、\`bin/\` 不会被注入运行时，这一条要在结论里写明，避免用户误以为脚本在跑。
- 设置页的插件卡片里有逐条诊断，先读它，再读文件。

## 1. 清单与路径

- 清单是否声明了 \`name\` 且合法；\`version\` 是否与包内实际内容一致。
- 所有组件路径是否都在插件根内（\`./\` 前缀、无 \`..\`、无符号链接逃逸）。
- 有没有声明却不存在的组件（作者以为在跑、实际没加载）。

## 2. 命令式钩子（\`hooks/hooks.json\`）

逐条读 \`command\`，问四个问题：

1. **命令做了什么**：是否能从名字与正文看出意图；有没有 \`curl … | sh\`、\`eval\`、\`base64 -d | sh\` 这类远程执行。
2. **输入注入**：命令里有没有拼接 \`\${user_config.*}\`（值会被 shell 再解析）；有没有把工具输入直接拼进 shell。
3. **能改什么**：\`PreToolUse\` 能阻断（收紧），\`PostToolUse\` 能改结果——**看它改不看得到的内容**（例如把错误抹掉）。
4. **超时与副作用**：默认 60s；脚本是否写盘、发网络请求、改用户仓库。

## 3. \`bin/\` 与 MCP

- \`bin/\`：放进会话 PATH，等于给 agent 一个随时可调用的可执行文件。读内容，看它是否只是包装器、是否下载并执行别的东西。
- \`.mcp.json\` / \`mcpServers\`：读 \`command\` / \`args\` / \`url\` / \`headers\`——里面有没有写死的 token、内网地址、
  以 \`sh -c\` 起 shell 的写法。MCP 服务器是**独立进程但以你的权限运行**。

## 4. \`extensions/\`（代码型，最需要谨慎）

- 以 Node 权限在服务进程内执行：看它注册了哪些 pi 事件、改不改工具输入输出、
  有没有读 \`process.env\`、有没有网络与写盘。
- 它是唯一能绕过「hook 只能收紧」这一约束的东西：能返回 \`allow\` 的地方要逐处核对。

## 5. 结论与分级

按影响面给三级，每条都要能落到「哪一行、为什么」：

- **阻断**：远程执行未知代码、明文的凭据外发、试图放宽权限、读写与插件无关的用户目录。
- **警告**：能改工具结果或工具入参、网络访问无白名单、依赖外部服务未说明、清单与内容不一致。
- **提示**：风格与文档问题、未使用的组件、诊断里的小错。

最后给一句明确建议：**可以直接启用 / 仅启用资源型组件 / 不要启用**，并写清来源档位带来的差异
（例如「来自第三方市场，钩子与扩展本来就不会注入」）。
`;

const SKILL_CREATE_SKILL = `---
name: skill-create
description: 引导创建一个技能（skills/<name>/SKILL.md），让模型按描述自动选用
---

# 创建技能

技能是给模型的说明书：**什么时候用、按什么步骤做**。模型只看得到技能的 description，
由它决定要不要读正文，所以描述要写触发场景（「审查改动时」「写提交信息时」），不要写「一个技能」。

## 1. 放哪

| 作用域 | 路径 | 何时选 |
| --- | --- | --- |
| 全局 | \`~/${HOME_DIRNAME}/skills/<name>/SKILL.md\` | 所有会话都能用 |
| 项目 | \`<项目根>/${HOME_DIRNAME}/skills/<name>/SKILL.md\` | 只在这个仓库里用；同名时压过全局 |

两条等价路径：**设置 → 技能**里新建（有表单与校验），或直接写文件——同一份磁盘文件，界面只是编辑器。
直接写文件时目录要自己建：\`mkdir -p <目录>\`，再写 \`SKILL.md\`。

- 目录名就是技能名：小写字母或数字，单词之间用单个连字符（\`commit-helper\` 可以，\`Commit_Helper\` 不行）。
- 技能可以带别的文件：\`references/*.md\` 放参考资料、\`scripts/*.sh\` 放脚本，正文里按相对路径引用。

## 2. 最小骨架

\`\`\`markdown
---
name: commit-helper
description: 按本仓库的规范写提交信息（用户说「提交」「写提交信息」时使用）
---

# 写提交信息

1. \`git diff --staged\` 看改了什么。
2. 若仓库里有提交规范文档，先读它取本仓库的口径。
3. 标题写「type(scope): 摘要」，正文说清为什么改。
\`\`\`

\`description\` **必填**：缺了它整条技能不会被装载（不是警告，是直接消失）。\`name\` 可省，会用目录名。

## 3. 怎么用、什么时候生效

- 模型按 \`description\` 自动选用；用户也可以 \`/skill:<name>\` 显式调用。
- **改动只对下一个新会话生效**：当前会话的技能清单在装配时就定下来了，写完当场用不上。

## 4. 写完自查

打开 **设置 → 技能**：确认这条出现在「本机与项目」段、来源是全局还是当前项目；
被同名的其他来源压住时，行上会写「被同名项覆盖：<路径>」。解析失败的文件列在页面底部的错误区
（缺 \`description\`、frontmatter 写坏都会出现在那里）。

## 常见坑

- 只有 \`skills/<name>/SKILL.md\` 这种「一个目录一个技能」的形态会被扫到，散在别处的 \`.md\` 不算。
- frontmatter 是 YAML：值里带冒号时要加引号，否则整段解析失败、技能消失。
- 正文写给模型看：写步骤与判据，不写给人看的背景介绍。
`;

const AGENT_CREATE_SKILL = `---
name: agent-create
description: 引导创建一个自定义角色（主模式或子智能体），写进 agents/<slug>.md
---

# 创建角色

角色 = 一段提示词 + 一组能力开关。两种用途：

- **主模式**（\`mode: primary\`）：像 build / plan / ask 那样当会话模式，决定这一轮的工具与提示词倾向；
- **子智能体**（\`mode: subagent\`，缺省）：由 \`subagent\` 工具委派出去干一件自包含的事。

## 1. 放哪

| 作用域 | 路径 | 何时选 |
| --- | --- | --- |
| 全局 | \`~/${HOME_DIRNAME}/agents/<角色名>.md\` | 所有会话都能用 |
| 项目 | \`<项目根>/${HOME_DIRNAME}/agents/<角色名>.md\` | 只在这个仓库里用；同名时压过全局 |

两条等价路径：**设置 → 子智能体**里新建，或直接写文件。
文件名就是 slug：小写字母开头，只含小写字母、数字与连字符。

## 2. frontmatter 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| \`description\` | 是 | 写进工具描述与角色选择器，模型按它挑选；说清「什么时候派它」 |
| \`name\` | | 展示名，缺省用文件名 |
| \`mode\` | | \`primary\` / \`subagent\` / \`all\`，缺省 \`subagent\` |
| \`tools\` | | 逗号分隔的工具名白名单；写 \`inherit\` 或留空即继承父会话（子角色）；主模式留空用默认工具集 |
| \`model\` | | 覆盖模型；留空继承父会话 |
| \`thinking\` | | 推荐思考档位，**只对主模式有效**（子角色写它会直接报错） |
| \`advertise\` | | \`false\` 时不列进工具描述，仍可按名调用 |
| \`hidden\` | | \`true\` 时不进角色选择器，仍可按名调用 |

**未知字段一律报错**：整个文件被跳过。写错拼写尤其危险——\`tools\` 写成 \`tool\` 会让能力静默变成「继承父会话」。

## 3. 最小骨架（只读审查角色）

\`\`\`markdown
---
name: 代码审查
description: 只读审查改动并列出问题（用户要求 review / 检查代码时委派）
tools: read, grep, find, ls
---

你只做审查，不改文件。

1. 先 \`git diff\` 看改动范围，再按文件读上下文。
2. 按「阻断 / 建议 / 提示」三档列问题，每条给 \`文件:行号\` 与理由。
3. 没有问题就说没有，不为了凑数挑风格。
\`\`\`

## 4. 生效与自查

- **新会话生效**；同名的自定义角色会覆盖内置的 build / plan / ask 与 general / explore。
- **设置 → 子智能体**：看来源（全局 / 当前项目）与是否被同名项覆盖；解析失败的条目在页面底部错误区。

## 常见坑

- 纯子角色不能与主模式同名（build / plan / ask）；要占位得用 \`mode: primary\` 或 \`all\`。
- 能力是「父会话 ∩ 角色定义」，收窄只能靠 \`tools\` 白名单：想要只读就别把 \`bash\` / \`write\` / \`edit\` 列进去。
- 子角色的思考档位按所属模式解析，自己声明不了。
`;

const COMMAND_CREATE_SKILL = `---
name: command-create
description: 引导创建一条提示词命令（prompts/<name>.md），用户用 /名字 调用
---

# 创建命令

命令 = 一个常用提示词模板：用户输入 \`/名字 参数\`，这段正文会替换掉命令本身。
与技能的分工：技能由模型按描述自动选用，命令是**用户主动**敲出来的。

## 1. 放哪

| 作用域 | 路径 | 何时选 |
| --- | --- | --- |
| 全局 | \`~/${HOME_DIRNAME}/prompts/<名字>.md\` | 所有会话都能用 |
| 项目 | \`<项目根>/${HOME_DIRNAME}/prompts/<名字>.md\` | 只在这个仓库里用；同名时压过全局 |

两条等价路径：**设置 → 命令**里新建，或直接写文件。文件名就是命令名
（小写字母或数字开头，只含小写字母、数字与连字符），只扫目录一级的 \`.md\`。

## 2. frontmatter

| 字段 | 说明 |
| --- | --- |
| \`description\` | 可选：显示在 \`/\` 菜单；留空取正文首行（截 60 字） |
| \`argument-hint\` | 可选：命令名后面的用法提示，如 \`[focus]\` |

## 3. 参数占位符

- \`$1\` \`$2\`：第 1、2 个参数（按空格拆分，引号可以保住空格）
- \`$@\` 或 \`$ARGUMENTS\`：全部参数
- \`\${1:-默认值}\`：参数缺失时用默认值；\`\${@:2}\` 从第 2 个起的全部；\`\${@:2:3}\` 再取 3 个

## 4. 最小骨架

\`\`\`markdown
---
description: 审查当前改动
argument-hint: [关注点]
---

审查这些改动，重点看 $1。

1. \`git diff\` 看全部改动。
2. 按「阻断 / 建议」两档给结论，每条带 \`文件:行号\`。
\`\`\`

## 5. 生效与自查

- **新会话生效**；命令只在输入框**开头**整条匹配（\`/名字 参数\`），写在正文中间不生效。
- 与内置动作重名（\`/new\`、\`/compact\`、\`/models\`、\`/help\` 等）不会覆盖它们，换个名字。
- **设置 → 命令**：核对来源与是否被同名项覆盖；它出现在 \`/\` 菜单里就算装载成功。

## 常见坑

- 正文里写 \`$1\` 这类占位符时想清楚用户会不会真给参数，缺参数会被替换成空串。
- 别在正文开头写标题式废话，模型看到的就是这段文字本身。
`;

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  {
    id: "plugin-create",
    description: `引导创建一个能被 ${brand.name}、Claude Code 与 ZCode 同时识别的插件包`,
    version: "0.1.0",
    files: { "SKILL.md": PLUGIN_CREATE_SKILL },
    requiredFiles: ["SKILL.md"],
  },
  {
    id: "plugin-review",
    description: "审计第三方插件（清单、钩子、bin、MCP、扩展的信任面），输出分级结论",
    version: "0.1.0",
    files: { "SKILL.md": PLUGIN_REVIEW_SKILL },
    requiredFiles: ["SKILL.md"],
  },
  {
    id: "skill-create",
    description: "引导创建一个技能（模型按 description 自动选用，也可 /skill:名字 调用）",
    version: "0.1.0",
    files: { "SKILL.md": SKILL_CREATE_SKILL },
    requiredFiles: ["SKILL.md"],
  },
  {
    id: "agent-create",
    description: "引导创建一个自定义角色（主模式或子智能体）",
    version: "0.1.0",
    files: { "SKILL.md": AGENT_CREATE_SKILL },
    requiredFiles: ["SKILL.md"],
  },
  {
    id: "command-create",
    description: "引导创建一条提示词命令（用户在输入框用 /名字 调用）",
    version: "0.1.0",
    files: { "SKILL.md": COMMAND_CREATE_SKILL },
    requiredFiles: ["SKILL.md"],
  },
];
