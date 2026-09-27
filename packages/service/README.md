# @ucode/service — 服务层

产品的调度中心：**唯一的后端**。它把 pi 当作**库**在进程内嵌入（调用并扩展 pi——工具、MCP、
斜杠命令、子智能体都是 pi 之上的能力），自己也持有状态，对控制层的壳只暴露协议 C。

## 内部结构

```
paths.ts        磁盘布局的唯一事实来源（数据根 → runtime / v1/{service,pi} → 各功能域路径）
service.ts      createService()：装配全部子系统，返回 Service（协议 C 的服务端）
types.ts        对外契约：Service / ServiceConfig / AttachmentView / ServiceBus
handshake.ts    hello → welcome：版本双校验、能力授予、会话摘要与续传应答
host/           实例锁 · 注册表与发现 · 端点探测 · 后台拉起与 ensure · 日志
transport/      stdio（嵌入式）· rpc（unix socket / tcp）· http（+SSE，兼发 Web 静态资源）· ws
session/        会话运行时：pi 装机器、多会话、事件扇出、游标续传、队列、差异落盘
capability/     信任矩阵 · 能力授予 · 自主级别 · 工具闸门 · 只读命令白名单 · 项目信任
interaction/    交互中转：提问与批准、广播路由、去重、超时降级、持久化待决
config/         供应商与模型配置（读写 pi 目录的 models.json / settings.json）
channels/       通道实现：workspace（文件树 / git / 读取）与 pty
storage/        会话正文（JSONL，pi 兼容）+ 索引与元数据（SQLite）
modules/        业务模块（一个域一个目录）+ 注册表
testing/        假供应商与端到端 harness（只给测试用，不进构建产物）
```

一个**业务模块**可以贡献三张脸：agent 面（pi 工具 / MCP / 命令 / 子智能体）、
服务面（协议 C 命令 + 事件 + 通道）、存储面（SQLite 表或服务目录下的文件）。

## 磁盘布局

```
<数据根>/                      UCODE_DATA_DIR，默认是家目录下的品牌数据目录
├── runtime/                   活句柄与本次运行的日志：不迁移、不进支持包、可随时删
│   ├── service.json            注册表（pid / serviceId / 端点 / 数据格式版本）
│   ├── service.lock            实例锁：一个数据根一个服务
│   ├── socket.sock             unix socket（路径过长则省略）
│   └── service.log             detached 进程的 stdout/stderr
└── v1/                        数据格式版本根
    ├── service/service.db      SQLite（WAL）：索引 / 待决交互 / 元信息 / 缓存
    └── pi/                    pi agent-dir：settings · models · auth · skills · prompts ·
                               themes · agents · extensions · sessions(JSONL) · npm · trust.json
```

分治规则：**需要查询、聚合、事务、跨会话引用的结构化状态进 SQLite；模型要直接读写、人类要能 diff、
或 pi 生态要识别的资源留在 pi 目录**。密钥只落 `<pi>/auth.json` / `models.json`，**永不入库**。

## 依赖边界

只允许依赖 `@ucode/protocol` 与 `@ucode/branding`（登记在 `tools/boundaries.json`）。
服务层**不依赖任何壳或 sdk**；反过来壳也**不依赖服务层**——反向验收会断言壳的生产依赖树里
没有 `@ucode/service`。

## 运行要求

Node ≥ 24：SQLite 用内建 `node:sqlite`（零三方依赖）。它是实验特性，进程启动会打一条
`ExperimentalWarning`；拉起常驻服务时用 `--disable-warning=ExperimentalWarning` 抑制。
