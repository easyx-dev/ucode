# @ucode/binding-stdio

stdio 绑定（协议 B）：把协议 C 的消息面搬到进程的标准输入输出上，行分隔 JSON。

## 职责

- 服务端：把核心层挂到 stdio 上，供**父进程 spawn** 的场景使用（CLI 内置 TUI、桌面壳）。
- 客户端：spawn 一个核心层进程并连上它；不传 `command` 时直接用当前进程的 stdio。
- **不做**：不做配对、不做寻址、不解析消息语义——只负责序列化与按边界切分。解析由核心层做。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `createBinding(core, options?) → TransportBinding`；类型 `StdioBindingOptions`（`{ input?, output?, trustLevel? }`） |
| `./client` | `src/client.ts` | `createStdioClient(options?) → Transport`；类型 `StdioClientOptions`（`{ command?, args?, cwd?, env? }`） |

## 传输语义

**行分隔 JSON（JSONL），按字节 `0x0a` 切分。**

必须按字节切分，禁用语言内置的行读取器：JSON 字符串里可以**合法**包含 `U+2028` / `U+2029`，部分运行时的行读取器会把它们当换行，导致消息被静默截断。这里只认 `0x0a` 这一个字节。

选 JSONL 而非长度前缀是有意的：stdio 通路要能被人直接阅读、能用 `jq` 处理。

## 信任级别

`implicit` —— 对端由本进程的父进程 spawn，等价于"这台机器的主人"。这是四种传输里最高的信任级别，因此也承载最全的能力集。

## 依赖位置

只依赖 `@ucode/protocol`。被 `@ucode/sdk`、`@ucode/cli` 依赖。

权威来源：[tools/boundaries.json](../../../tools/boundaries.json) 的 `@ucode/binding-stdio` 条目。

## 关键约束

- **不得依赖 `core` / `sdk` / `ui`**：绑定只认协议，否则"只装壳时依赖树里不含 core"的反向验收必然失败。
- **绑定之间互不依赖**：共享判断（如 `isLoopbackHost`）放在 `@ucode/protocol`。
- 走 stdio 时 **stdout 是协议线**，日志必须写 stderr，否则会污染消息流。
- 信任级别由绑定自己声明，不由客户端自报。

## 开发

```bash
pnpm -F @ucode/binding-stdio typecheck
pnpm -F @ucode/binding-stdio build
```

测试随根 `pnpm test`（传输层测试用成对的内存流，不 spawn 真进程）。
