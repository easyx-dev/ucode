# @ucode/cli

统一的启动入口（`bin`）：内置 Web 与 TUI 壳，也能只启动核心层。

## 职责

- 解析命令行参数，按子命令分派。
- `core start`：起 headless 核心层并选一条绑定。
- `web` / `tui`：起内置壳（web 会把核心层与静态资源放同一端口；tui 默认自己 spawn 一个核心层）。
- `provider` / `node`：维护模型供应商配置与核心层节点登记。
- **不做**：不含业务逻辑，一律调用 `@ucode/core`、绑定包与各壳。

## 子命令

| 子命令 | 作用 |
|---|---|
| `core start` | 启动核心层，`--binding stdio\|rpc\|http\|ws`（默认 `stdio`） |
| `web` | 启动内置 Web 壳：核心层 + HTTP/SSE + 静态资源同端口，默认 `127.0.0.1:3000` |
| `tui` | 启动内置 TUI 壳；`--core <endpoint>` 可连一个已在跑的核心层，省略则自己 spawn |
| `provider add` | 写入模型供应商配置（`--base-url`、`--model`，可选 `--api-key` / `--id` / `--api`） |
| `provider list` | 列出当前可用的模型 |
| `node add` | 登记节点（`--name` + `--url`，或 `--socket` / `--host` / `--port`） |
| `node list` / `node remove` | 列出 / 移除已登记的节点 |

全局参数：`--data-dir`、`--cwd`、`-h/--help`、`-v/--version`。`core start` 另有 `--socket`、`--host`（默认环回）、`--port`、`--autonomy`、`--allow-non-loopback`；`web` 另有 `--host`、`--port`、`--allow-non-loopback`。

## 运行

```bash
pnpm ucode web --port 3000
pnpm ucode tui
pnpm ucode core start --binding rpc --socket /tmp/core.sock
pnpm ucode provider add --base-url <端点> --model <模型> --api-key <密钥>
```

根脚本 `pnpm ucode` 已带 `--conditions=dev-src`，因此直接跑 `src/main.ts` 源码。也可以 `pnpm -F @ucode/cli build` 出 `dist`。

## 依赖位置

依赖 `@ucode/core`、`@ucode/sdk`、四个绑定包、`@ucode/branding`、`@ucode/protocol`，以及 `@ucode/tui`、`@ucode/web`。

**本包是唯一允许直接依赖 `@ucode/core` 的一方**；各壳不得依赖核心层（反向验收会拦）。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/cli` 条目。

## 关键约束

- **stdout 归协议通道**：stdio 绑定下 stdout 是协议 C 的线，因此所有日志都走 stderr。
- **数据层默认目录来自品牌配置**（`envVar("DATA_DIR")` → 回落到 `~/<dataDirName>`），代码里不出现目录名字面量。
- `bin` 的命令名同样由品牌派生，README 与帮助文本里不硬编码产品名。
- 非环回监听必须显式 `--allow-non-loopback`，此时信任级别降为 `untrusted`（只读 + 对话）。
- 子命令清单以 `src/options.ts` 的 `COMMANDS` 为唯一事实来源（帮助文本由它生成）。

## 开发

```bash
pnpm -F @ucode/cli typecheck
pnpm -F @ucode/cli build
```
