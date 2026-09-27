# @ucode/binding-http

HTTP + SSE 绑定（协议 B）：下行用 SSE 推、上行用 POST 提交，按标识配对。

## 职责

- 服务端：起一个 Hono HTTP 服务，把核心层挂上去；同一端口顺带把 Web 壳的静态资源发出去。
- 客户端：以 SSE 收下行、POST 发上行。
- **不做**：不自己做配对逻辑——它只是把两个方向接到同一条协议 C 连接上（以 `x-client-id` 为寻址）。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `createBinding(core, options?) → TransportBinding`；类型 `HttpBindingOptions`（`{ port?, host?, staticDir?, allowNonLoopback? }`） |
| `./client` | `src/client.ts` | `createHttpClient(options) → Transport`；类型 `HttpClientOptions`（`{ baseUrl, clientId, fetchImpl?, reconnectDelayMs? }`） |

路由：`GET /health`、`POST /rpc`（上行）、`GET /events`（SSE 下行）。

## 传输语义

HTTP 是纯请求-应答的传输，**必须配对**：下行用 SSE 推（含 `ui.request`），上行用 POST 提交（含 `ui.response`），按标识配对。SSE 是长连接，因此下行可以承载服务端主动推送，交互面得以成立。

`staticDir` 存在时，同端口托管 Web 壳并做 SPA 回退——于是 Web 壳与核心层同源，没有 CORS 与 cookie 的麻烦。

## 信任级别

- 环回 → `local`
- 非环回 → `untrusted`（本通路没有认证）

**监听非环回时若未显式允许则拒绝启动**（抛错）：不允许出现"无意间暴露了一个无认证端口"。

## 依赖位置

依赖 `@ucode/protocol`；外部依赖 `hono`、`@hono/node-server`。被 `@ucode/sdk`、`@ucode/cli` 依赖。

权威来源：[tools/boundaries.json](../../../tools/boundaries.json) 的 `@ucode/binding-http` 条目。

## 关键约束

- **不得依赖 `core` / `sdk` / `ui`**；绑定之间互不依赖。
- **SSE 是长连接**（I-4）：优雅退出时 `server.close()` 会一直等连接自己结束，必须 `closeAllConnections()` 强制断连，否则 SIGTERM 之后进程不退出。
- 未认证的非环回通路在信任矩阵下会被裁掉 `tools.direct`：不是本层做的裁剪，但本层必须如实把 `untrusted` 报上去。
- 绑定必须把 HTTP 静态资源的缓存语义与 `base` 处理对好，否则壳的产物更新后浏览器仍读旧文件。

## 开发

```bash
pnpm -F @ucode/binding-http typecheck
pnpm -F @ucode/binding-http build
```

测试随根 `pnpm test`（含交互配对的端到端用例）。
