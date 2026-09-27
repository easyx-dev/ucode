# @ucode/data-layer-spec

协议 D（数据层）的规范与一致性套件。叶子包——只规定"目录以内长什么样"，不含实现。

## 职责

- 定义数据层目录布局、会话标识规则、会话文件解析、错误码与版本可读性判定。
- 提供 `createConformanceSuite(factory)`：把任意 `Store` 实现传进去，返回整套协议 D 一致性用例。
- **不做**：不读文件系统、不落盘。实现是 `@ucode/store`。

## 公开入口

单一子路径 `.`（`src/index.ts`）。

| 主要符号 | 作用 |
|---|---|
| `createConformanceSuite` | 传入 `StoreFactory`，产出协议 D 一致性用例清单 |
| `Store` / `StoreFactory` / `SessionRepo` / `StoreOptions` | 实现契约（类型） |
| `parseSessionFile` / `serializeEntry` | 会话文件解析与条目序列化 |
| `encodeProjectDirName` / `sessionFileName` / `createSessionId` / `SESSION_ID_PATTERN` | 目录与文件名规则 |
| `isSafeSessionId` / `isSafePathSegment` | 路径安全校验 |
| `DataLayerError` / `DATA_LAYER_ERROR_CODES` | 错误类型与错误码 |
| `isDataLayerVersionReadable` | 数据层版本可读性判定 |

## 依赖位置

零内部依赖。被 `@ucode/store`、`@ucode/core` 依赖。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/data-layer-spec` 条目。

## 关键约束

- **目录布局是 pi agent-dir 的超集**：`settings.json` / `models.json` / `auth.json` / `AGENTS.md` / `sessions/` 等沿用 pi 约定，因此 `PI_CODING_AGENT_DIR=<数据层目录>` 即可让 pi 生态读写同一份数据。可以**新增**条目，改已有条目的形状会破坏这个兼容性。
- **会话标识** `<毫秒时间戳 base36>-<随机后缀>`：不共享计数器，因此无需跨进程协调；写入前必须过 `SESSION_ID_PATTERN` 等路径安全校验。
- **一致性套件是实现的一部分**：新增 `Store` 实现（或改动协议 D）必须让它过 `createConformanceSuite`，而不是各自手写零散测试。

## 开发

```bash
pnpm -F @ucode/data-layer-spec typecheck
pnpm test
```

开发态直跑 `src/*.ts`，无需构建。
