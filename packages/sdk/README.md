# @ucode/sdk

headless 控制层 SDK：建连、命令封装、事件折叠、断线续传。

## 职责

- 建立并维护到服务层的协议 C 连接（握手、心跳式的状态同步、断线带游标自动重连）。
- 把命令面封装成方法（会话增删改、对话与打断、模型与供应商、任务、交互应答、工作区查询）。
- 事件折叠：把服务端事件流折叠成可直接渲染的状态（`SdkState`）与展示项（`DisplayItem`）。
- 节点注册表：多实例/直连远端的寻址。
- **不做**：不含 DOM、不含 UI、不假设传输。传输是**注入**的，因此 TUI 能只复用 sdk，Web 与桌面复用 `@ucode/ui`（ui 再复用 sdk）。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `connect`、`applyServerMessage`、`toDisplayItems`、`NodeRegistry`、`endpointKey`；类型 `AgentSdk`、`SdkState`、`ConnectOptions` |
| `./stdio` | `src/transports/stdio.ts` | `createClient`（注入 stdio 传输）、`ClientOptions` |
| `./rpc` | `src/transports/rpc.ts` | `createClient`（unix socket / TCP 长度前缀） |
| `./http` | `src/transports/http.ts` | `createClient`（HTTP + SSE） |
| `./ws` | `src/transports/ws.ts` | `createClient`（WebSocket） |
| `./node-transport` | `src/node-transport.ts` | `transportForNode(node)`：按节点记录选 HTTP 或 RPC 传输 |

各传输子路径导出**同名**的 `createClient` / `ClientOptions`，只是来自对应绑定包的别名——壳只 import 自己那一份。

## 用法

```ts
import { connect } from "@ucode/sdk";
import { createClient } from "@ucode/sdk/http"; // 浏览器只引这一份，node:net 不进打包结果

const sdk = await connect({
  transport: createClient({ baseUrl: location.origin, clientId }),
  clientKind: "web",
  capabilities: ["sessions.read", "prompt.run", "interaction.respond"],
});

sdk.subscribe((state) => render(state)); // 快照，不返回新建对象
const { sessionId } = await sdk.createSession({ cwd });
```

## 依赖位置

依赖 `@ucode/protocol`；四种传输的**客户端实现就在本包的 `src/transports/`**（`@ucode/sdk/http` / `-rpc` / `-stdio` / `-ws` 子路径），服务端那一半在 `@ucode/service` 的 `src/transport/`，两侧只共享 protocol 的消息 schema。

被依赖：`@ucode/ui`、各壳（`cli` / `web` / `desktop` / `tui`）。**不被** `core` 依赖。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/sdk` 条目。

## 关键约束

- **保持 headless**：不 import `ui`、不假设 DOM——这是 TUI 能只复用 sdk 的前提。
- **传输走子路径**（I-6）：浏览器只 import `@ucode/sdk/http`，`node:net` / `node:child_process` 不能进打包结果，同时不新增 `apps/* → bindings/*` 这条边。
- `capabilities` 是**声明**不是请求：服务层按信任矩阵决定实际授予什么，`welcome` 才是结果。
- 事件折叠只增不改：状态快照必须稳定，否则前端选择器恒变（I-5）。
- `ConnectOptions.resume` 带上上次收到的位置即可续传，不需要重建会话。

## 开发

```bash
pnpm -F @ucode/sdk typecheck
pnpm test
```

开发态直跑 `src/*.ts`，无需构建。
