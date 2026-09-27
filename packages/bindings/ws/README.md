# @ucode/binding-ws

WebSocket 绑定（协议 B）：一帧一消息。

## 职责

- 服务端：基于 Hono 的 node-ws 起 WebSocket 端点，把核心层挂上去。
- 客户端：连上端点并收发协议 C 消息（自带重连）。
- **不做**：不做配对、不解析消息语义。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `createBinding(core, options?) → TransportBinding`；类型 `WsBindingOptions`（`{ port?, host?, path?, allowNonLoopback? }`，`path` 默认 `/ws`） |
| `./client` | `src/client.ts` | `createWsClient(options) → Transport`；类型 `WsClientOptions`（`{ url, reconnectDelayMs? }`） |

另有 `GET /health`。

## 传输语义

**一帧一消息。**

WS 是双向传输，因此交互面天然支持——不需要 HTTP 那种"下行推、上行 POST"的配对。`TransportBinding` 与客户端传输的接口形状与其他绑定一致，因此壳可以按配置互换传输而不改上层代码。

## 信任级别

- 环回 → `local`
- 非环回 → `untrusted`

与 HTTP 同规则：非环回监听必须显式声明，且信任级别降为 `untrusted`（只读 + 对话）。

## 依赖位置

依赖 `@ucode/protocol`；外部依赖 `hono`、`@hono/node-server`、`@hono/node-ws`。被 `@ucode/sdk`、`@ucode/cli` 依赖。

权威来源：[tools/boundaries.json](../../../tools/boundaries.json) 的 `@ucode/binding-ws` 条目。

## 关键约束

- **不得依赖 `core` / `sdk` / `ui`**；绑定之间互不依赖。
- 一帧一消息意味着**帧边界即消息边界**：不能把多条消息塞进一帧，也不能把一条消息拆到多帧。
- 非环回监听未显式允许时必须拒绝启动，与 HTTP 保持同一口径。

## 开发

```bash
pnpm -F @ucode/binding-ws typecheck
pnpm -F @ucode/binding-ws build
```

测试随根 `pnpm test`。
