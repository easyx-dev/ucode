# @ucode/store

协议 D 的参考实现：数据层的**唯一写会话文件者**。

## 职责

- 打开/创建数据层目录，管理布局（`settings.json` / `models.json` / `sessions/` 等）。
- 会话文件的追加写、尾部修复、游标（行号）维护。
- owner 租约：一个数据层同时只有一个写者，其余实例是只读跟随者。
- 派生索引的读、写、对账与重建。
- **不做**：不解释对话语义、不调用模型、不依赖 `core`。

## 公开入口

单一子路径 `.`（`src/index.ts`，对 9 个模块全量再导出）。

| 主要符号 | 作用 |
|---|---|
| `openStore` | 主入口：`StoreFactory`，解析/创建数据目录并返回 `Store` |
| `Store` / `StoreOptions` / `SessionRepo` / `OwnerLease` | 契约类型（定义在 `@ucode/data-layer-spec`） |
| `followSession` | 只读跟随者：`fs.watch` 主路径 + 轮询兜底 |
| `storePaths` / `managedDirs` / `resolveDataDir` | 目录布局 |
| `readIndex` / `writeIndex` / `scanSessions` / `isIndexFresh` | 派生索引 |
| `writeFileAtomic` / `appendLine` / `truncateToLastNewline` | 原子写与追加写原语 |
| `acquireOwner` / `isOwner` / `anyOwnerAlive` | owner 租约 |
| `detectDangerousFileSystem` / `assertPermissions` / `resolveWithin` | 启动期守卫 |
| `writeProviderConfig` / `readProviderConfig` | `models.json` 读写（供应商密钥的唯一落点） |

## 用法

```ts
import { openStore } from "@ucode/store";

const store = await openStore({ dataDir, ownerId: "core-1" }); // 目录不存在则创建（权限 0700）
const session = await store.createSession({ cwd: process.cwd() });
const sessions = await store.listSessions({ cwd: process.cwd() });
const lease = await store.acquireOwner(session.id); // 竞争写者租约；他人持有时返回 undefined
await store.close();
```

`openStore` 会先跑危险文件系统探测、权限校验、数据层版本校验，任一不过**直接拒绝启动**而不是静默修正。

## 依赖位置

依赖 `@ucode/data-layer-spec`（契约与套件）。被 `@ucode/core` 依赖。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/store` 条目。

## 关键约束

- **本包是唯一写会话文件者**：核心层不得绕过它直接读写会话文件。
- **非追加写必须原子**：走临时文件 + rename（`writeFileAtomic`），不能就地覆写。
- **索引是派生数据，而写它的是别的实例**：`listSessions` 必须与磁盘 mtime 对账，否则跨实例会一直读到旧索引（表现为"侧栏条目数不动"）。
- **`fs.watch` 会合并/丢事件**：跟随者必须有轮询兜底，不能只依赖监听。
- **迁移是原地重写**：inode 不变，因此"检测 inode 变化"不足以发现整体替换；迁移必须作为显式事件通知全体 attachment 重新全量同步。
- 供应商密钥只写进 `models.json`（pi 生态同一份定义），覆盖写时"没给新密钥就保留原来那把"。

## 开发

```bash
pnpm -F @ucode/store typecheck
pnpm test    # 含 conformance.test.ts（协议 D 一致性套件）与 follower.test.ts
```

开发态直跑 `src/*.ts`，无需构建。
