# 数据库规范

SQLite 存的是应用自有数据：会话索引与展示用元数据。**会话内容的事实源是 pi 的 JSONL 文件**
（`$APP_HOME/pi/sessions/*.jsonl`），数据库只是它的派生索引。这条边界决定了本规范里删除、对账与容错的取向——
库里的数据都可再生，可以随时删掉重建。

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
| 时间 | `created_at` / `updated_at` | `updated_at` |
| 布尔 | 语义形容词，不加 `is_` 前缀 | `persisted` |
| 计数 | `*_count` | `message_count` |
| 索引 | `idx_<表>_<列>[_<列>]` | `idx_session_updated_at` |

禁止：复数表名、驼峰列名、`tbl_` / `col_` 之类前后缀、SQLite 保留字作标识符。

### `session` 表的列分组

`session` 有意保持单表，但列分两组语义，**新增列必须先归组**：

- **覆盖值组**（用户可改、允许为空、未设置时回落到全局默认）：`name` / `cwd` / `model` / `thinking_level`
- **派生索引组**（由 JSONL 解析得到、以文件为准、由 `reconcile()` 覆盖）：`pi_name` / `pi_cwd` /
  `source_path` / `persisted` / `entry_count` / `message_count` / `preview` / `created_at` / `updated_at`

两组唯一的重叠是 `created_at` / `updated_at`：首次落盘前只有覆盖值组，落盘后由 `refresh()` 用文件时间覆盖。

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

- 默认硬删，不做软删（当前无审计与回收需求）
- 仓储的 `delete(id)` 只删自己那张表的行，不感知文件与内存
- 关联资源的清理由调用方按固定顺序编排，顺序不能颠倒：

  1. 停用运行中的资源：`pool.dispose(sessionId)`、`events.remove(sessionId)`
  2. 删数据库行
  3. 删文件（JSONL 等）

- 有活跃生成时先拒绝并返回 `409 session_busy`，不允许删除进行中的会话
- 禁止无条件 `DELETE`（不带 `WHERE`）；确需清空要写专用方法并说明理由
- `reconcile()` 是唯一的全量对账入口：以 JSONL 为准补齐缺失行、删除文件已消失的已落盘行；
  草稿行（`persisted = 0`）不属于文件，保留

## 容错

- 库里只存可再生产的数据，损坏或丢失时删除文件重建即可，不做备份与恢复流程
- 读取路径的解析失败一律回落而不是抛出，避免脏行打挂接口
- 派生字段变更时同步更新 `reconcile()`，它是全量修复的唯一入口
