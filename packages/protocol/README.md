# @ucode/protocol

协议 C（服务层接口面）与传输线格式的消息 schema 与类型。叶子包，不依赖任何内部包。

## 职责

- 定义服务层接口面上的全部消息形状：握手、命令与参数、会话事件、交互请求/应答、通道（工作区与 PTY）、任务、用量、市场、供应商回读形状。
- 提供 Zod schema 与解析函数，作为协议 C 的唯一线契约。
- **不做**：不含任何实现，不读写磁盘，不依赖 `service` / `sdk` / 任何壳。

## 公开入口

单一子路径 `.`（`src/index.ts`，对 16 个模块全量再导出）。

| 主要符号 | 作用 |
|---|---|
| `parseCommand` | 未知载荷 → 带类型的命令参数（`ParsedCommand`） |
| `parseClientMessage` / `parseServerMessage` | 线上文本/对象 → `ParseResult<ClientMessage \| ServerMessage>` |
| `isVersionSupported` | 版本是否落在本端可读区间内 |
| `Capability` / `TrustLevel` / `AutonomyLevel` | 权限两条轴的取值集合 |
| `ClientMessage` / `ServerMessage` | 方向相反的两个消息面 |
| `CoreServer` / `BindingConnection` / `TransportBinding` | 绑定层面对的服务层契约（接口，非实现） |
| `COMMAND_CAPABILITIES` | 命令 → 所需能力登记表；新增命令必须在此登记 |

## 依赖位置

零内部依赖（外部只有 `zod`）。被 `@ucode/service`、`@ucode/sdk`、`@ucode/ui`、`@ucode/hub` 与各壳依赖。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/protocol` 条目。

**为什么是叶子包**：服务端（`@ucode/service`）与客户端（`@ucode/sdk`）都只依赖本包，因此壳不必依赖服务层——"壳的依赖树里不含 `@ucode/service`"这条反向验收才成立。协议 C 的类型与服务端接口（`CoreServer`）一起下沉到这里，就是为了这一点。

## 关键约束

三条架构性硬约束落在本包，改动时不能松：

- **能力声明与能力授予分离**：`hello` 只声明客户端能承载什么，`welcome` 才由服务层按信任矩阵回告实际授予什么。二者不可合并成一个字段——否则"客户端声称自己能做什么"就等于"它能做什么"。
- **版本双向校验、从不静默降级**：`isVersionSupported` 只在 `[MIN_READABLE_PROTOCOL_VERSION, PROTOCOL_VERSION]` 内为真；不兼容时给 `rejected`，不允许"退到能跑的版本"。
- **交互面方向与命令面相反**：`ClientMessage` / `ServerMessage` 分开定义，不复用同一个联合类型。

## 开发

```bash
pnpm -F @ucode/protocol typecheck
pnpm test
```

开发态直跑 `src/*.ts`，无需构建（工具链显式打开 `dev-src` 条件）。新增命令时，在此声明 Zod 入参 schema 并同步登记 `COMMAND_CAPABILITIES`，否则服务层会以可诊断的拒绝理由挡下。
