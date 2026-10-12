# 插件开发

> 本文由 `plugin-create` 技能真身生成，**不要手工编辑**：改内容请改
> `server/src/harness/plugins/builtin/skills.ts`，再运行 `pnpm plugin:docs`。
>
> 面向使用者的说明（安装、启停、兼容范围与安全边界）见 [plugins.md](./plugins.md)。

# 创建插件包

目标是让一个目录变成**三端都能装**的插件：本产品读 `.ucode-plugin/plugin.json`，
Claude Code 读 `.claude-plugin/plugin.json`，ZCode 读 `.zcode-plugin/plugin.json`。
三份清单内容一致时，放进任意一端都能用。

## 1. 最小骨架

```
my-plugin/
├── .ucode-plugin/plugin.json     # 本产品清单（也可放 .claude-plugin / .zcode-plugin）
├── skills/<name>/SKILL.md        # 技能：模型按 description 选用
├── commands/<name>.md            # 命令：用户用 /<name> 调用
├── agents/<name>.md              # 子角色：由 subagent 工具委派
├── hooks/hooks.json              # 命令式钩子：在工具调用前后跑脚本
├── bin/<executable>              # 加进会话 PATH 的可执行文件
├── .mcp.json                     # MCP 服务器
└── extensions/*.ts               # 本产品专属：pi 扩展（代码型，随包或本地登记才生效）
```

清单可以缺省：没有 `plugin.json` 时按上面的标准目录布局加载，插件名取目录名。

## 2. 清单字段

| 字段 | 说明 |
| --- | --- |
| `name` | 必填，小写字母或数字开头，只含小写字母、数字与 `.` `_` `-`；它是命名空间 |
| `displayName` / `description` / `version` | 展示名、一句话说明、版本（缺省 `0.0.0`） |
| `skills` / `commands` / `agents` | 覆盖默认目录；`skills` 与 `extensions` 是**叠加**，其余是**替换** |
| `hooks` / `mcpServers` | 与 `hooks/hooks.json` / `.mcp.json` **合并**；也可直接内联 |
| `userConfig` | 需要用户填写的配置项 |

不认识顶层字段只出诊断（信息级别），不影响其它组件；字段类型不符才算坏清单。

## 3. 命名与变量

组件在界面上叫 `<plugin>:<name>`，底层 token 是 `<plugin>-<name>`；与已占用名字冲突时自动加哈希后缀，
不用自己避让。正文与 hook 命令里可以写：

- `${UCODE_PLUGIN_ROOT}`：插件安装目录（`CLAUDE_PLUGIN_ROOT` / `ZCODE_PLUGIN_ROOT` 是别名）
- `${UCODE_PLUGIN_DATA}`：跨版本保留的插件数据目录
- `${UCODE_PROJECT_DIR}`：会话工作目录
- `${user_config.KEY}`：`userConfig` 里用户填的值

**shell 形式的 hook 命令里不要用 `${user_config.*}`**：值会被 shell 再解析一遍，等于把注入面交给用户输入。

## 4. 安装与调试

1. 打开「设置 → 插件」，在输入框填插件目录的**绝对路径**，点「从目录安装」。
   安装**不复制内容**，改完源文件点「重拉」即可生效。
2. 技能与命令出现在 `/` 菜单里（来源标 `plugin`）；角色出现在角色选择器里（slug 带插件前缀）。
3. 诊断写在插件卡片里：坏清单、越界路径、不认识的事件或字段都会逐条列出来。

## 5. 常见坑

- **组件路径必须以 `./` 开头**，且归一化后仍在插件根内；经符号链接逃出根会被拒绝。
- 技能的两种写法都行：`skills/<name>/SKILL.md`（一个目录一个技能），或清单直接指向某个含 `SKILL.md` 的目录。
- 前端没有界面插槽：插件不改界面，只贡献资源与代码（扩展）。要展示信息就写进技能正文或命令输出。
- 第三方市场的钩子、扩展与 `bin/` **不会注入运行时**（管理员只信任随包与本地登记的插件）；
  开发期请用「从目录安装」自测。
- 清单、角色文件、hooks 都是**宽松解析**：写错一处只跳过那一处并出诊断，不会整包失败；但钩子写错了不会报错，
  只会「看起来没生效」——先在本地目录安装下确认它真的跑了。

---

> 内置技能 `plugin-create`（v0.1.0）与本文同源：在会话里用 `/skill:plugin-create` 可以边做边问。
