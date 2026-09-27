# @ucode/cli

统一的启动入口（`bin`）：内置 Web 与 TUI 壳，也能只启动核心层。

## 职责

- 解析命令行参数，按子命令分派。
- `service`：**常驻的唯一后端**（BS 架构的服务端），所有壳都是它的客户端。
- `core start`：起 headless 核心层并选一条绑定（脱离控制层单独跑时用）。
- `web` / `tui`：打开内置壳。默认都是"确保本机服务在跑，再连它"。
- `provider` / `node`：维护模型供应商配置与核心层节点登记。
- **不做**：不含业务逻辑，一律调用 `@ucode/core`、绑定包与各壳。

## 子命令

| 子命令 | 作用 |
|---|---|
| `service start` | 拉起常驻服务后返回；`--foreground` 前台运行（Ctrl-C 即停）；`--no-http` 只留 unix socket |
| `service status` / `stop` | 查看（pid / 端点 / 数据层 / 会话数）/ 优雅停止并清理注册 |
| `service logs [-f]` | 查看服务日志（`-f` 持续跟踪） |
| `core start` | 启动核心层，`--binding stdio\|rpc\|http\|ws`（默认 `stdio`） |
| `web` | 打开 Web 壳：确保服务在跑并打印地址（`--open` 顺带开浏览器）；`--foreground` 前台把服务跑起来 |
| `tui` | 启动内置 TUI 壳；默认连本机服务（没有就拉起），`--core <endpoint>` 连别处 |
| `provider add` | 写入模型供应商配置（`--base-url`、`--model`，可选 `--api-key` / `--id` / `--api`） |
| `provider list` | 列出当前可用的模型 |
| `node add` | 登记节点（`--name` + `--url`，或 `--socket` / `--host` / `--port`） |
| `node list` / `node remove` | 列出 / 移除已登记的节点 |

全局参数：`--data-dir`、`--cwd`、`-h/--help`、`-v/--version`。`service start` 另有 `--host`（默认环回）、`--port`、`--autonomy`、`--allow-non-loopback`、`--no-http`；`core start` 另有 `--binding`、`--socket`；`web` 另有 `--foreground`、`--open`。

## 运行

```bash
pnpm ucode service start          # 常驻服务（壳会自动拉起，一般不必手敲）
pnpm ucode web --open             # 打开 Web 壳（服务没跑就先拉起）
pnpm ucode tui                    # 连本机服务；--core http://127.0.0.1:3000 连别处
pnpm ucode service status         # pid / 端点 / 数据层 / 会话数
pnpm ucode service stop
pnpm ucode core start --binding rpc --socket /tmp/core.sock   # 只起核心层，不注册为服务
pnpm ucode provider add --base-url <端点> --model <模型> --api-key <密钥>
```

根脚本 `pnpm ucode` 已带 `--conditions=dev-src`，因此直接跑 `src/main.ts` 源码。也可以 `pnpm -F @ucode/cli build` 出 `dist`。

## 依赖位置

依赖 `@ucode/core`、`@ucode/sdk`、四个绑定包、`@ucode/branding`（含 `@ucode/branding/node`）、`@ucode/protocol`，以及 `@ucode/tui`、`@ucode/web`。

**本包是唯一允许直接依赖 `@ucode/core` 的一方**；各壳不得依赖核心层（反向验收会拦）。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/cli` 条目。

## 关键约束

- **stdout 归协议通道**：stdio 绑定下 stdout 是协议 C 的线，因此所有日志都走 stderr。
- **一个数据层一个服务**：注册表、单实例锁、unix socket 与服务日志放在**品牌运行时目录**（`runtimeDir()`，可用 `UCODE_RUNTIME_DIR` 覆盖），不放数据层目录——那是会被迁移与支持包带走的地方。判定"服务活着"要注册表 + 端点探测双重确认，因此 `kill -9` 留下的陈旧状态既不会被误判为活着，也不会让这个数据层再也起不来。
- **服务由壳按需拉起**：壳先发现、连不上才拉起，"用户忘了先起服务"不会变成错误。
- **数据层默认目录来自品牌配置**（`envVar("DATA_DIR")` → 回落到 `~/<dataDirName>`），代码里不出现目录名字面量。
- `bin` 的命令名同样由品牌派生，README 与帮助文本里不硬编码产品名。
- 非环回监听必须显式 `--allow-non-loopback`，此时信任级别降为 `untrusted`（只读 + 对话）。
- 子命令清单以 `src/options.ts` 的 `COMMANDS` 为唯一事实来源（帮助文本由它生成）。

## 开发

```bash
pnpm -F @ucode/cli typecheck
pnpm -F @ucode/cli build
```
