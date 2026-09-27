# ucode

基于 [pi.dev](https://pi.dev)（Earendil Inc. 的 Pi agent harness，MIT）构建的分层智能体。

## 当前状态

**步骤 0–5.5 已落地**（Web/TUI/桌面三壳、四种绑定、PTY 通道、多实例跟随、无人值守待决交互）；
后续功能按"全量补齐"推进，**uhub 与远控除外**（进度见[实现设计 §七 步骤 7](docs/impl/00-实现设计.md)）。

- 单仓多包：`packages/`（库）· `apps/`（cli | web | desktop | tui）· `hub/`（单独部署，可缺省）；每个包都有自己的 `README.md`，写定位、公开入口与依赖边界。
- 依赖严格单向（`apps/* → ui → sdk → bindings/* → protocol`；`core → store → data-layer-spec`），由**允许列表门禁**在 CI 拦截。
- 品牌参数化：产品名、数据层目录名等一律从 `@ucode/branding` 读取，源码里禁止出现字面量（同样有门禁）。
- 已落地：协议 C 的 Zod schema · 协议 D 的参考实现 + 一致性套件（18 例）· 核心层（握手 / 会话运行时 / 交互中转 / 工具闸门 / 工作区查询）· 四种绑定（stdio / rpc / http+SSE / ws）· headless SDK · CLI · TUI（Ink）· Web 壳（React + Tailwind）。
- 后续功能推进中（除 uhub 与远控外全做）：**项目级记忆（F-2.5）**——`core/memory/`，含系统提示注入、`memory` 工具、真实模型验证（`spike/memory-live.ts`）；**生命周期钩子（F-3.7）**——`core/hooks/`，`hooks.json` 配置子进程钩子，覆盖 SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop；**插件/扩展加载（F-3.5）**——数据层 `extensions/`・`skills/`・`prompts/`・`themes/` 即插件，core/plugins 提供发现接口；**子智能体（F-2.3/F-3.3）**——`core/subagents/`，Markdown+frontmatter 定义、前台/后台 runner、内置 `general-purpose` 与只读 `explore`；**目标模式（F-1.6）**——`core/goal/`，持久目标 + 每轮独立校验 + 自动续跑（`agent_before_settle` 边界）+ 额度上限，与计划模式互斥；**自动化任务（F-4.1~4.4）**——`core/tasks/`，cron 解析 + 任务文件持久化 + 无状态调度器（闲时让路、会话绑定、保持唤醒），协议新增 `task.*` 命令；**TUI 复用基座组件层**——`apps/tui` 改用 `@earendil-works/pi-tui`（Text/Container/Input/SelectList/TuiMainScreen），`view.ts` 为纯函数视图层；**Web UI 对齐 zcode**——主题 token 取自 ZCode 的 `DARK_TUI_THEME`，并接入**自动化面板（F-4.5）**（SDK 六个 `task.*` 方法 + `TasksPanel`：定时/一次性/闲时任务的新建、暂停、立即运行、删除与历史）；**会话编辑与回退**——`session.edit_entry`（追加式上下文改写）、`core/undo/`（按轮撤销文件改动，`undo_files`）、**辅助对话**（`session.create {ephemeral:true}`，内存仓库、不落盘不进列表）、**提问超时自动继续**、**划选追问**；**工作区面板**（F-2.7/F-2.8）——SDK 四个 `workspace*` 便捷方法 + UI 文件树/变更/历史/预览（`.md` 走 Markdown）；**Wiki 生成**（F-2.6）——`core/wiki/`，读取过滤（依赖/构建产物/敏感文件/二进制/超大/符号链接）+ 三重预算 + 真实模型生成并落盘；**AI SSH**（F-6.5）——`core/ssh/`，连接注册表（不存密钥）+ `ssh` 工具（list/add/remove/run，argv 传递不经本地 shell）；**外部 Agent 导入**（F-3.9）——`core/import/`，认得 `.claude-plugin`/`.agents`/`commands`/`agents`/`skills`/`AGENTS.md`/`.mcp.json`，只读源目录、复制并留 `importedFrom` 来源、不覆盖已有同名文件；**桌面本机能力**——托盘（含菜单）、系统通知、`safeStorage` OS 凭据存储（加密不可用拒存）、`keepAwake`→`powerSaveBlocker` 接线、内置浏览器窗口；**CI 与发布**——`.github/workflows/{ci,release}.yml`，两条必跑验收做成可本地复跑脚本（`tools/acceptance-*.ts`），发布态配置独立（签名/公证/dmg，凭据走 secrets）；**用量统计/支持包/迁移向导**（F-5.6~5.8）——`core/insights/`，从会话记录本地聚合用量、导出脱敏的 `.json.gz` 支持包、迁移先只读预检再执行（冲突默认跳过）；**插件市场**（F-3.6）——`core/marketplace/`（源登记 + 目录 + 安装/卸载，只读源、不覆盖）与 UI `MarketplacePanel`。其余项见[实现设计 §七 步骤 7](docs/impl/00-实现设计.md)。

```bash
pnpm install
pnpm check                                            # 类型检查 + Biome + 两道门禁 + 测试（294 例）
pnpm build:libs                                        # 产出库包 dist（安装/发布形态；开发态直跑源码）
pnpm ucode provider add --base-url <端点> --model <模型> --api-key <密钥>   # 配一个模型（本地权威）
pnpm ucode web --port 3000                            # 浏览器打开 http://127.0.0.1:3000
pnpm ucode tui                                        # 终端里的壳（默认自己拉起核心层）
```

核心层也可以脱离控制层单独跑：`pnpm ucode core start --binding stdio|rpc|http|ws`。

**架构已完成技术验证并定稿**：`docs/spec/` 是 ucode 的**定稿需求与架构**（基线 tag `spec-baseline`）——骨架已确认，承重假设（V-1…V-10）已逐条验证（`V-5` 推翻、`V-8` 部分，处置见 [03](docs/spec/03-假设与验证.md)）。

需要坐实的**技术假设**集中登记在 [03 假设与验证](docs/spec/03-假设与验证.md)；**业务输入**（B-1…B-10）已确认，同样记录在那里。

## 从这里开始

| 你是 | 先读 |
|---|---|
| 要了解产品要做什么 | [00 需求与功能](docs/spec/00-需求与功能.md) |
| 要实现它的人 | [01 架构](docs/spec/01-架构.md) |
| 要追问某个设计为什么这么做 | [02 决策记录](docs/spec/02-决策记录.md) |
| 要跟进未定事项 | [03 假设与验证](docs/spec/03-假设与验证.md) |

## 文档结构

```
docs/spec/
  00-需求与功能.md    产品定位、核心场景、需求条目 R-n、功能清单 F-n
  01-架构.md          分层与协议、信任模型、数据层、核心层接口面、绑定层、远程与 uhub、包结构、技术选型、复用策略
  02-决策记录.md      ADR：决策 / 理由 / 被否方案 / 否掉的原因
  03-假设与验证.md    技术假设 V-n、已确认的业务输入 B-n、风险登记、唯一台账
docs/impl/
  00-实现设计.md      仓库与目录组织、包划分与职责、依赖图、调用与运行、构建测试、实现步骤
  01-架构总览图.md    四层与三协议 · 依赖方向 · 信任级别（视觉索引）
```

正文用 `【已决】/【实现级】` 内联标注：`【已决】` 是已确认的结论，`【实现级】` 是可自由替换的具体做法；验证记录汇总在 `03`。

## 一句话概括

一台机器上的数据层是**一个目录**（`~/.ucode`）。核心层是 headless 的智能体本体，只对外暴露一套与传输无关的接口面。绑定层把这套接口面序列化到 stdio / JSON-RPC / HTTP / WebSocket 上。控制层是这些协议的具象化，首发送代 **Web 壳与桌面壳**（共享 React 组件层），TUI 与移动端属后续。一台机器可以有多个核心层实例指向同一个数据层目录。远程能力由 AI SSH、远控、uhub 中继提供，三者都不改核心协议。

## 命名与品牌

上游默认：项目名 `ucode`，数据层路径 `~/.ucode`，中继服务 `uhub`（中文「枢纽」）。**产品名、数据层目录名、logo 属可配置的品牌配置（构建期注入）**，B 端定制 = 换一份品牌配置与资源、重新构建（见 [ADR-023](docs/spec/02-决策记录.md)）。

## 仓库位置

`/Users/lyy/code/project/ucode-work/ucode/`。
