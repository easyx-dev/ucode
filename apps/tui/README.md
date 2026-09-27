# @ucode/tui

终端宿主：复用基座 `@earendil-works/pi-tui` 的组件层，只依赖 `@ucode/sdk`。

## 职责

- 把 SDK 的状态渲染成终端界面：对话流、输入框、状态行、命令补全与帮助。
- 键盘与斜杠命令的分派，SDK 调用的发起。
- **不做**：不复用 `@ucode/ui`（终端渲染与 DOM 渲染没有共同组件）；不依赖 `@ucode/core`（默认自己 spawn 一个核心层，或连已有的）。

## 公开入口

| 入口 | 主要符号 |
|---|---|
| `src/index.ts` | `runTui(options): Promise<number>`；类型 `TuiLaunchOptions`（`{ productName, spawnCore?, endpoint?, capabilities? }`） |
| `src/app.ts` | `runPiTui(options)`；类型 `PiTuiOptions`（I/O 与组件挂载） |
| `src/view.ts` | 纯函数视图层：`transcriptLines`、`statusLine`、`sessionItems`、`hintLine`、`bannerFor`、`helpText`、`commandSuggestions`、`formatItem`、`usageOf`、`COMMAND_SPECS` |

## 运行

```bash
pnpm ucode tui                       # 默认自己 spawn 一个核心层
pnpm ucode tui --core http://127.0.0.1:3000
pnpm ucode tui --core unix:/tmp/core.sock
```

斜杠命令：`/help`、`/new`、`/sessions`、`/model`、`/provider`、`/autonomy`、`/tasks`、`/quit`。

## 依赖位置

依赖 `@ucode/sdk`、`@ucode/branding`；外部 `@earendil-works/pi-tui`。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/tui` 条目。

## 关键约束

- **`view.ts` 是纯函数视图层**（状态 → 终端行，无 terminal/IO），`app.ts` 只做 I/O 与命令分发：这样视图逻辑可以单测而不必真的开终端。
- **只写 `.ts` + `createElement`，不用 JSX**：本包由 Node 原生类型剥离直跑，而类型剥离不支持 JSX。
- **命令清单是帮助文本与自动补全的唯一来源**（`COMMAND_SPECS`）：新增命令只改这一处。
- pi-tui 的 `Editor` **不会替调用方清空输入框**：提交回调收到文本后必须自己 `setText("")`。
- `toDisplayItems` **已经把流式尾巴算进去了**（末尾补 `__streaming__` / `__streaming_thinking__`）：视图层若再拼一遍会出现两段一样的回答。

## 开发

```bash
pnpm -F @ucode/tui typecheck
```

开发态直跑 `src/*.ts`，无需构建。
