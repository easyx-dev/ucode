# 数据库规范

SQLite 存的是应用自有数据：会话索引与展示用元数据。**会话内容的事实源是 pi 的 JSONL 文件**
（`$APP_HOME/agent/sessions/*.jsonl`），数据库只是它的派生索引。这条边界决定了本规范里删除、对账与容错的取向——
索引与内容都可由 JSONL 再生，可以随时删掉重建；覆盖值组是例外，见「列分组」。

实现落位：`server/src/db/`。

## 文件与连接

- 位置 `$APP_HOME/app/app.db`，路径只从 `env.dbPath` 取，不硬编码
- 单进程单连接（`node:sqlite` 的 `DatabaseSync`），不做连接池
- 打开时必须设置三项 PRAGMA：

| PRAGMA | 值 | 作用 |
| --- | --- | --- |
| `journal_mode` | `WAL` | 读写并发 |
| `foreign_keys` | `ON` | `node:sqlite` 默认关闭，不设则外键约束不生效 |
| `busy_timeout` | `5000` | 等待锁，而不是立刻抛错 |

## 迁移

- schema 版本记在 `PRAGMA user_version`；`migrations` 以版本号（从 1 开始）为键，值为该版本的 DDL
- **只追加**：已发布的迁移项不得修改或删除，改 schema 就加新版本号
- 每个版本一个事务，DDL 与 `user_version` 的更新同事务提交，失败整体回滚
- 项目处于开发初期：破坏性 schema 变更直接改现有版本项，本地删掉 `app.db` 重建即可，不写数据迁移
- 注意：改的是**已有版本项**时，本地已建好的库不会重跑该版本，改动不会生效（例如重命名索引、调整列）——
  这类改动只影响新建的库，所以要么删库重建，要么补一个更高版本号
- 迁移只写 DDL，不放数据回填与业务逻辑

## 命名

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 表 | 单数、snake_case | `session` |
| 列 | snake_case | `thinking_level` |
| 主键 | 固定名 `id`，`TEXT PRIMARY KEY`，应用侧 `randomUUID()` 生成 | `id` |
| 外键 | `<单数表名>_id`，需带 `REFERENCES <表>(id) ON DELETE CASCADE` | `session_id` |
| 时间 | `created_at` / `updated_at` / `deleted_at` | `updated_at` |
| 软删 | 统一用 `deleted_at`（可空时间；非空即已软删），不用 `archived_at` / `removed_at` 等别名 | `deleted_at` |
| 布尔 | 语义形容词，不加 `is_` 前缀 | `persisted` |
| 计数 | `*_count` | `message_count` |
| 索引 | `idx_<表>_<列>[_<列>]` | `idx_session_updated_at` |

禁止：复数表名、驼峰列名、`tbl_` / `col_` 之类前后缀、SQLite 保留字作标识符。

### `session` 表的列分组

`session` 有意保持单表，列分两组语义，**新增列必须先归组**：

- **会话状态组**（应用自己写、会话文件里没有对应表示）：`name` / `cwd` / `model` /
  `thinking_level` / `mode`（未设置回落 `build`）/ `deleted_at`（软删标记，非空即已归档）
- **列表缓存组**（为列表与搜索服务，由 `refresh()` 在生成落定后回写）：`source_path` /
  `preview` / `created_at` / `updated_at`

`cwd` 在建会话时按 pi 的 `resolvePath` 口径规范化（绝对化并折叠 `.` / `..`），
草稿与落盘用同一个值，避免同一目录因写法不同被分成两组。

会话正文的事实源是 pi 的 JSONL；`source_path` 指向它，也是「还没落盘」的判据（为 null 时
文件尚未写出）。**不再从文件回读任何元数据**（外部导入能力已放弃），所以删库重建后
`name` / `cwd` / `model` / `thinking_level` / `mode` 会丢失——这是有意的取舍。

## 类型映射

| 语义 | SQLite | JS / TS | zod |
| --- | --- | --- | --- |
| 字符串 / id | `TEXT` | `string` | `z.string()` |
| 时间 | `TEXT`（ISO 8601 UTC） | `string` | `z.string()` |
| 布尔 | `INTEGER`（0 / 1） | `boolean` | `z.number()` 后转 |
| 计数 | `INTEGER` | `number` | `z.number()` |
| 数值 / 成本 | `REAL` | `number` | `z.number()` |
| 枚举 | `TEXT` | 字面量联合 | `z.string()` + 白名单校验 |
| 可空 | 允许 `NULL` | `T \| null` | `.nullable()` |

- 时间统一 ISO 8601 UTC 字符串，与接口层口径一致，排序可直接用字符串比较
- 布尔不写 `CHECK`，由映射层在 `0/1` 与 `boolean` 之间转换，读取用 `=== 1` 判定
- 枚举写入前必须过白名单（复用 `@ucode/contracts` 的常量）；读取遇到非法值按「未设置」回落，
  不让脏数据把接口打挂（见 `toThinkingLevel`）

## 代码组织

```
server/src/db/
  index.ts              # 连接与迁移，无业务语义
  <聚合>-repository.ts   # 一个聚合一个文件，导出 class
```

- `db/index.ts` 只负责打开连接与跑迁移，除表名外不出现业务概念
- 一个聚合一个仓储类；构造函数可注入 `DatabaseSync`（默认 `openDatabase()`），便于单测
- 行对象不跨层：仓储内部用 zod `rowSchema` 解析，经 `toRecord` 映射成领域类型后对外
- 领域类型（`SessionRecord` / `SessionOverride`）与入参类型放仓储文件，不另建 types 文件
- 领域层拿不到数据库句柄，SQL 不外泄

## SQL 约束

- SQL 只出现在仓储层，路由与业务代码不得直接持有数据库句柄
- 一律参数绑定（`?`），**禁止把值拼进 SQL 字符串**；只有列名这类固定片段可以拼接
- 查列用显式列清单，禁止 `SELECT *`：加列不应改变既有查询的结果形状
- 单行用 `.get()` / `.run()`，多行用 `.all()`
- upsert 统一 `INSERT ... ON CONFLICT(<主键>) DO UPDATE SET`；「只在有新值时覆盖」用 `COALESCE(excluded.x, 表.x)`
- 涉及多条语句的写操作包事务（`BEGIN` / `COMMIT` / `ROLLBACK`）
- 过滤与排序下推到 SQL，不在 JS 里查全表再过滤；`LIMIT` 走绑定参数

## 删除

- **默认软删**：用户动作（界面叫「归档」）只把 `deleted_at` 写成当前时间；行、JSONL、
  `$APP_HOME/workspace/<sessionId>/` 全部保留
- 读取语义：列表默认过滤 `deleted_at IS NULL`；按 id 直取仍可读（为以后的「归档箱 / 恢复」留路）
- 内存资源照旧释放，软删只影响磁盘：
  1. `pool.dispose(sessionId)`、`events.remove(sessionId)`
  2. `interactions.forget(sessionId)`、`permissions.clear(sessionId)`
  3. 回写 `deleted_at`
- 硬删只剩一种用途：对账时删「有行无文件」的行（这种行没有任何内容，谈不上归档）；
  仓储的 `delete(id)` 是硬删，只给对账与测试用
- 有活跃生成时先拒绝并返回 `409 session_busy`，不允许归档进行中的会话
- 禁止无条件 `DELETE`（不带 `WHERE`）
- 不再有草稿 TTL：会话在首条消息时才创建，空行由对账清理
- 孤儿工作区（没有对应会话行的目录）由池心跳顺带用 `cleanOrphanWorkspaces()` 清掉；
  工作区只属于未绑定目录的会话、且在它真正要跑时才建（`pool.ensure`），DB 行一定早于目录存在，
  「无行」即「无主」，所以不设 TTL

## 容错

- 库里只存会话状态与列表缓存，损坏或丢失时删掉 `app.db` 重建即可；代价是会话的
  `name` / `cwd` / `model` / `thinking_level` / `mode` 与归档标记一并丢失（见「列分组」）
- 读取路径的解析失败一律回落而不是抛出，避免脏行打挂接口
- 对账（`reconcile()`）只做减法：删掉文件已消失的行，不再从文件还原元数据
