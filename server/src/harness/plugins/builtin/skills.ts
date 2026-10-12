/**
 * 内置技能的真身：随包发布、物化到 `$APP_HOME/app/builtin/skills/<id>/`。
 *
 * 正文写成 TS 常量而不是 `.md` 文件：`.md` 需要 esbuild 的 text loader 加运行期（tsx）支持，
 * 目前两条链路都要动；等 `docs/plugin-authoring.md` 的生成脚本落地时再改成文件真身。
 *
 * 正文里的产品名、清单目录名与环境变量前缀**一律从品牌派生**：换品牌时这两个技能要跟着变，
 * 不能出现硬编码字面量（`scripts/verify` 的 brand 校验会拦下）。
 */
import { brand } from "@ucode/brand/values";

/** 本品牌清单目录名：`.<slug>-plugin` */
const MANIFEST_DIRNAME = `.${brand.slug}-plugin`;

/** 环境变量前缀：`<SLUG>_PLUGIN_ROOT` 这类 */
const ENV_PREFIX = brand.slug.toUpperCase();

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
];
