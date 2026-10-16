# 模式与权限

本文是「助手模式」与「权限」的单一事实源：讲清会话能做什么（工具集）、什么时候必须停下来问人（审批），
以及两者如何在一次工具调用上叠加。实现落位见各节引用的代码路径。

## 两层模型

一条工具调用要过两道独立的闸门：

1. **准入（会话模式）**：`build` / `plan` / `ask` 或自定义 primary agent 决定提示词倾向、**工具声明**
   与一组 `deny` 规则。只读模式（`plan` / `ask`）的工具声明与 `build` 一致，只读性完全由 `deny` 规则
   在调用时落地（见下节「只读为什么不收窄工具集」）。
2. **审批（会话权限档位）**：`default` / `auto` / `full` 只决定判定结果是 `ask` 时**弹审批还是自动放行**。
   它不改变工具集，也**永远不突破 `deny`**。

所以档位只能「放宽询问」，不能「授予能力」：在只读模式下把档位调到 `full`，`write` / `edit` 照样被阻断，
`bash` 也只放行被判定为只读的命令，`browser_act` 只在受管实例里放行（`deny` 与上下文条件都不参与放宽）；
浏览器的观察面四个都按默认规则放行（没有站点级审批，见下节）。

## 会话模式

模式是主会话角色（primary agent）的 slug，决定能力三元组（提示词片段 + 工具集 + 权限规则）。
内置三个，声明在 `server/src/harness/setup/agents/profiles.ts`，工具名清单在 `server/src/harness/setup/tools/names.ts`。
工具集里有两个条件注册项：记忆工具与目标结算工具（`goal_complete` / `goal_blocked`）只在**会话有 active 目标**
时挂上，且仅限**未断写盘**的默认集会话（即 `build`；判定见 `isReadOnlyCapability`）——只读模式不该有
「结算目标」这回事，子会话不该替父目标结算。目标工具因此不会在设完目标就立即生效：`goals/set` 与恢复
会先把会话池里的实例重装一次（会话文件是权威，重建不丢上下文）。

| 模式 | 界面文案 | 工具集 | 专属权限规则 | 推荐思考档位 | 用途 |
| --- | --- | --- | --- | --- | --- |
| `build` | 编码 | 默认集：`read` / `bash` / `edit` / `write` / `grep` / `find` / `ls` + `codemode` + 自研工具（`webfetch` / `websearch` / `question` / `subagent` / 记忆工具 / `goal_complete` / `goal_blocked`）+ 浏览器工具（`browser_*`，只在默认集会话注册）；Windows 上另有 `powershell` | 无（只受全局默认规则约束） | `xhigh` | 正常编码与执行 |
| `plan` | 计划 | 与 `build` 相同，另多 `present_plan`（提交计划的收尾工具） | `deny` `edit` / `write`；`bash` / `powershell` 兜底 `deny` + 放行被判定为只读的命令；`browser_act` 只在受管实例里放行；浏览器观察面按默认规则放行 | `max` | 先调研出方案；方案成型时才以 `present_plan` 收尾，前端弹决策表单，可批准 / 反馈 / 忽略（忽略只对这次计划生效） |
| `ask` | 问答 | 与 `build` 相同（无 `present_plan`） | 与 `plan` 相同 | `medium` | 只读分析与回答 |

### 只读为什么不收窄工具集

只读模式不再把写盘 / 执行工具从声明里拿掉，而是声明照旧、靠 `deny` 规则在 `tool_call` 上阻断
（执行类工具另加一条只读放行，见下节）。
原因是「切模式会换工具表」会制造一个我们踩过的坑：pi 把工具声明写进会话文件（`toolsAdded` /
`toolsRemoved`）并在后续请求里回放，切换模式就成了工具表的突变；模型会把上一轮的旧工具表当成事实，
之后每轮都照旧表回答（“我没有 write”），即使这一轮已经声明了—`prompt` 也改不过来这一点。
声明保持不变、只读落在规则上，就没有「旧表」这回事，同时保住三个闸门：工具调用（含 codemode 的嵌套调用）、
子会话（父会话模式规则一并施加，取较严者）、以及不受权限档位影响的 `deny`。

### 只读命令的判定

只读角色的执行类工具（`bash` / Windows 上的 `powershell`）不是整批断掉，而是**先兜底 `deny`、
再放行被判定为只读的命令**：判定在 `server/src/harness/setup/permissions/read-only-command.ts`，
规则上用一个**上下文条件**表示（`{ action: "allow", when: "readOnlyCommand" }`）——条件不成立的判定
（包括 `isReadOnlyCapability` 那种空对象探测）命不中放行那条，只剩兜底的 `deny`；弹窗与阻断文案显示的仍是命令原文。

判据是**保守**的——证明不了「这条命令只读」就不放行：

- 引号外的 `;` / `&&` / `||` / `|` 拆成简单命令，**每一段都要命中白名单**（`cat a | head -3` 放行，`ls | tee out` 不放行）；
- 重定向（`>` / `<` / `2>&1`）、命令替换与变量展开（`$(…)` / 反引号 / `$VAR`，双引号里也一样）、
  子 shell 与括号结构一律判为不可判定；
- **bash 与 PowerShell 的词法分开**：`\` 只在 bash 里是转义，PowerShell 里它是普通字符（`C:\` 随处可见），
  当成转义会把紧跟其后的 `;` / `|` 吃掉、让第二条命令混进同一个词，所以两者各按自己的引号与转义规则切词；
- 白名单只收「不写盘、不执行代码」的命令：`ls` / `cat` / `head` / `tail` / `wc` / `pwd` / `stat` / `file` /
  `du` / `df` / `tree` / `readlink` / `realpath` / `basename` / `dirname` / `rg` / `grep` / `find` / `sort` /
  `cut` / `tr` / `nl` / `comm` / `diff` / `uniq` / `jq` / `cd`，以及 git 的只读子命令（`status` / `log` / `diff` /
  `show` / `blame` / `describe` / `rev-parse` / `rev-list` / `ls-files` / `ls-tree` / `cat-file` / `shortlog` /
  `whatchanged` / `grep`）；Windows 上另有 `get-childitem` / `get-content` / `get-item` / `get-location` /
  `select-string` / `select-object` / `where-object` / `measure-object` / `resolve-path` / `test-path` 这些只读 cmdlet；
  「不带参数是查询、带参数就写」的动词（`git branch` / `git tag` / `git remote`）一个都不列——要列就得逐参数判定，
  改成 `git log --all --oneline` / `git ls-files` 这类写法（查当前分支用 `git rev-parse --abbrev-ref HEAD`）；
- 会写盘 / 执行代码的参数整条挡掉：`git diff --output=` / `--ext-diff` / `--textconv` / `--filters`、
  `git grep -O` / `--open-files-in-pager`、`find -delete` / `-exec` / `-fprint`（含 `-fprint0` 这类带后缀的写法）、
  `sort -o` / `-T` / `--compress-program`、`rg --pre` / `--hostname-bin`、`tree -o` / `-R`、`file -C`、
  `uniq a b`（第二个位置参数是输出文件）；长选项按 GNU / git 的写法认（`--output` / `--output=f` / 缩写 `--outp`），
  但同前缀的不同选项不算（`--pretty` 不会因为以 `--pre` 开头被拦）；
- 白名单之外的命令（`pnpm check|test`、构建、装依赖、`node -e`、`sed -i`）一律阻断；要看测试结果请切编码模式。

`git -c alias.x='!rm -rf .' x` 这类全局开关不放行（子命令必须正好是第二个词）。判定也**不承诺命令内部没有副作用**：
`git diff` / `git log -p` 会调起仓库配置里的 `diff.external` 与分页器，这类由当前仓库或用户配置决定的执行面不在
判定内。**参数不做任何路径判定**：白名单命令读哪个文件不检查，所以 `cat .env`、`cat /etc/hosts`、`cat ~/.bashrc`
（`~` 由 shell 展开，不在上面那句「变量展开」的范围内）与工作目录之外的路径都能读到——
不读环境变量文件这件事**靠提示词里的约定**约束模型（计划 / 问答的模式约束里写明了），不是硬拦截；
白名单只保证「命令本身是只读查询」，其余见「安全边界」。

### 思考档位

档位有两个层面，口径不同不要混：

- **偏好**（会话行 `thinking_level`，接口上是 `SessionSummary.thinkingLevel`）：`auto` 或具体档位。
  `auto` 是缺省值，表示「按本会话模式的推荐档位」。
- **实际生效档位**（`SessionSummary.resolvedThinkingLevel`）：注入 pi 的那个具体档位。
  `auto` 按上表的推荐值解析；pi 还会按模型能力做一次 clamp（未显式映射 `xhigh` / `max` 的模型会被夹到
  相邻可用档），所以显示以 pi 的实际值为准——摘要在会话驻留内存时取的正是它。

解析只认**本会话的模式**（`recommendedThinkingLevelOf`）：子会话行的 `mode` 就是父的 mode，
所以委派出去的子智能体也按父模式的推荐值跑，子角色自己不声明档位。自定义 primary 角色
（`mode: primary` / `all`）可在 frontmatter 里写 `thinking` 覆盖推荐值；纯 `subagent` 角色写它会直接报错，
因为那不是它能决定的事——要单独调某个子会话，用 `subagent` 工具的 `thinkingLevel` 入参。

会话里显式选过档位就以会话为准（优先级：会话偏好 > 模式推荐值），切换会重建会话实例并在
会话文件里追加 pi 原生的 `thinking_level_change`（记的是解析后的实际档位，不是 `auto`）。
新建会话时请求里没给档位的话，取所属项目**最近一次选择**的档位（没记住即 `auto`）——项目按 cwd 归口，
见 [`docs/api.md`](./api.md)「项目」。

- 只读模式**整批 `deny` 写盘**（`edit` / `write`），**执行类工具（`bash`、Windows 上另有 `powershell`）
  只放行被判定为只读的命令**（见上节）。
  路径类工具不做「允许但限制路径」——命令里的路径无法可靠解析，那是假约束。
  它落在规则层（不是从工具表里去掉），所以连同 `codemode` 的嵌套调用与子会话一起拦住。
- **浏览器的观察面照常可用**：`browser_open` / `browser_snapshot` / `browser_screenshot` / `browser_close`
  在只读模式下不落 `deny`，四个都按默认规则放行（没有站点级审批）。
  哪几个算观察面写在 `harness/features/browser/tools.ts` 的 `BROWSER_OBSERVE_TOOL_NAMES`（新增的浏览器工具
  默认落在阻断侧）。
- **`browser_act`（点击 / 输入 / 滚动 / 表达式求值）只在受管实例里放行**：条件是 `when: "managedBrowser"`，由装配层每次判定
  现问浏览器服务（`BrowserHooks.isManaged`）——attach 连的是你自己的调试实例、desktop 驱动的是桌面端面板里你正看着的
  标签，那两种下点一下就是真的点在你的浏览器与登录态上，因此仍走兜底的 `deny`。这条与档位无关，也不看站点的审批。
  它在实际形态上弱于命令白名单：打开页面会起进程、出网，用 `profile` 还会复用你自己的登录态，详见
  [`browser.md`](./browser.md) 的「安全边界」。
- 自定义 primary agent 可覆盖同名内置项或另取新名；`mode` 是字符串 slug，服务端按角色注册表校验。
- 子智能体是独立的 subagent 角色（`general` / `explore`），能力 =「父会话 ∩ 角色定义」；工具取交集、
  权限取较严者（`general` 这类 `inherit` 在默认集父下保留默认集，不再被收窄成只读），**只读父会话靠
  父模式的规则拦住子会话**。
  父一侧施加的只是**父会话模式的规则**（`parentModeRules`，即该模式 `capability.permissions` 里的 `ask` /
  `deny`）：全局默认规则与会话授权在子会话自己的规则里已有一份，父一侧重复施加会把它们（以及技能目录放行）
  重新打回审批——用户在父会话放行过的范围，子会话里照样弹窗。

## 权限引擎

实现：`server/src/harness/setup/permissions/`。规则是声明式的，挂在 pi 的 `tool_call` 拦截上
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
显式规则与会话恒允照常覆盖。

### 审批与「本会话恒允」

命中 `ask` 时挂起并向本会话事件流发一条请求，前端弹权限审批弹窗，三个答复（`PERMISSION_DECISIONS`）：

- `allow_once`：只放行本次；
- `allow_session`：**按判定给出的范围追加一条 `allow` 规则**（规则类 `ask` 用规则串，越界检查用父目录通配），
  之后的同类调用直接命中；
- `deny`：阻断。

审批不设等待时限，用户不答复就一直挂着；本轮中断（stop）与会话归档按拒绝结算，避免工具调用永久挂起。
「本会话恒允」只存在进程内存，删 / 归档会话时清理，服务重启回到规则默认。

子会话触发的审批归属**根会话**（弹窗、记录、授权都记在它名下），所以一次授权对整棵会话树生效：
子会话下的 `allow_session` 与父会话自己点的一样，之后同范围的调用（含子会话）都不再询问。

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
- `deny` 在任何档位都不变：`.env` 阻断、只读模式对写盘与（非受管实例里的）页面操作的阻断，以及执行类工具
  「白名单之外一律阻断」的兜底，都不受档位影响（只读命令与受管实例都是**上下文条件**，同样不看档位）。
- `full` 在输入区用 warning 色标记，提示它已跳过越界审批；选中时不弹二次确认。
- 切换档位与换模型 / 换模式同款处理：生成中拒绝（`409 session_busy`），落库后重建会话实例（`pool.dispose`），
  并用 `session_updated` 事件下发，多端同步。

### 与新建 / 分叉 / 子会话的关系

- **新建会话**：档位按所属项目最近一次的选择继承（见 [`docs/api.md`](./api.md)「项目」），
  项目没记住过时回落 `default`。输入区空态（还没有会话）**不提供档位入口**（选择器禁用）——
  继承是继承「上回的选择」，而不是在还没看到会话时就随手把审批放宽；要改档位请在会话里改。
- **会话分叉**不继承档位：`sessions/fork` 生成的新会话从 `default` 开始。
- **子智能体**继承父会话档位：父在 `auto` / `full` 时，委派出的子会话沿用同一档位，不退回默认。
  该继承发生在**子会话创建时**，之后不再跟随父会话变化——父会话收紧档位时，已创建（含续跑）的子会话
  仍按创建时的档位运行。
- 子会话与分叉都不会写回项目：它们拿到的值来自父会话 / 源会话的继承，不算用户在那个项目里的「选择」。

## 安全边界

- 本仓库**没有 OS 级沙箱**：`cwd` 与只读规则都不是安全边界（pi 的 `security.md` 明示 cwd 不阻止命令访问其他路径）。
  对外承诺的是「**只读模式下调不了写盘工具、执行被收窄到只读命令**」：写盘与浏览器由权限引擎在 `tool_call` 上
  `deny`，执行类工具只放行白名单里判定的只读命令（含 codemode 的嵌套调用与子会话），而不是靠工具不存在；
  切到编码模式后 `bash` / `powershell` 能做什么仍然不受限。
- 白名单**只覆盖它能识别的写法**：命令内部的副作用（`git` 的 `diff.external` / 分页器、第三方工具自己的配置）
  与白名单外的命令都在承诺之外——判据就是「不可判定即不放行」，新出现的写法默认落在阻断侧。
  只读模式放行的浏览器观察面同理：它读到的页面内容是不可信外部内容，也不能防止页面自己发请求。
- **工作台终端是用户自己的通道**：它按你在界面里的输入跑命令，不套 agent 的命令拦截，也不受模式与权限档位约束。
- `deny` 只是应用层拦截，不是内核约束；档位与「恒允」都只能在这个层内放宽 `ask`。
- 服务默认只监听回环且 `/api/v1` 已加鉴权（见 [`docs/api.md`](./api.md)「鉴权」），但**通过鉴权即等于本机 owner**：
  背后的 agent 带 `read` / `write` / `edit` / `bash`（Windows 上还有 `powershell`）权限。
  **不要把服务暴露到公网或不可信网络**，见 [`README.md`](../README.md) 的安全提示与 [`TODO.md`](../TODO.md)。
