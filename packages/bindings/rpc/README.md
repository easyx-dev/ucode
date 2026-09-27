# @ucode/binding-rpc

JSON-RPC 绑定（协议 B）：unix socket 或 TCP，4 字节大端长度前缀。

## 职责

- 服务端：把核心层挂到 unix socket 或 TCP 端口上。
- 客户端：连上该端点并收发协议 C 消息。
- **不做**：不做配对、不解析消息语义。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `createBinding(core, options?) → TransportBinding`；类型 `RpcBindingOptions`（`{ socketPath?, port?, host?, trustLevel? }`） |
| `./client` | `src/client.ts` | `createRpcClient(options) → Transport`；类型 `RpcClientOptions`（`{ socketPath?, host?, port? }`） |

## 传输语义

**4 字节大端长度前缀 + JSON 载荷。**

与 stdio 刻意不统一：stdio 用 JSONL（要能被人读、能用 `jq`），rpc 是纯机器通道，用长度前缀彻底绕开换行歧义——连 `U+2028` 那类讨论都不需要。

## 信任级别

- unix socket → `local`（受文件权限约束：能连上就是同一个 OS 用户）
- TCP 环回 → `local`
- TCP 非环回 → `untrusted`（本通路没有认证，非环回时什么都证明不了）

## 依赖位置

只依赖 `@ucode/protocol`。被 `@ucode/sdk`、`@ucode/cli` 依赖。

权威来源：[tools/boundaries.json](../../../tools/boundaries.json) 的 `@ucode/binding-rpc` 条目。

## 关键约束

- **不得依赖 `core` / `sdk` / `ui`**；绑定之间互不依赖。
- 信任级别由绑定自身推导，不由客户端自报。
- unix socket 路径与 socket 文件的生命周期（残留文件清理）由本层负责。

## 开发

```bash
pnpm -F @ucode/binding-rpc typecheck
pnpm -F @ucode/binding-rpc build
```

测试随根 `pnpm test`。
