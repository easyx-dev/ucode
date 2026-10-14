# 变更日志

**何时更新**：改动涉及项目流程状态时——新增/调整 pnpm 脚本、环境变量、启动方式、依赖、目录结构、
对外接口。纯 bugfix、文案、内部重构不写。

**结构**：简体中文，倒序（最新在上）。

```md
## [未发布]

### 新增

- …

### 变更

- **桌面端窗口透明 + macOS 系统材质**：`BrowserWindow` 补 `transparent` 与
  `vibrancy: "under-window"` / `visualEffectState: "followWindow"`，`backgroundColor` 留空避免首帧白闪；
  桌面端的页面自身不再铺不透明底色（`apps/desktop/src/renderer/index.css` 覆盖共享基础层的
  `body { bg-background }`）。玻璃层（外壳 / 侧栏 / 移动端抽屉的 `--glass` + `backdrop-blur`）因此
  真正透出桌面材质；内容卡仍是实色（那是「纸」层，不跟着透）。非 macOS 不做：`transparent`
  在那边要配合无边框窗口，而本壳只在 macOS 走自绘标题条。

- **`ucode.step` 补四个字段并修正 `ttftMs` 口径**：新增 `userTurn`（用户轮序号，由会话池在 run 入口推进——
  `turn` 只是本次装配内的往返序号，会话重装后归零，不能当轮边界）、`provider` / `model` / `stopReason`
  （回答来自哪个模型、以什么原因收尾）；`ttftMs` 改为「响应头 → 首个内容帧」（原先算的是「请求发出 →
  首个内容帧」，与 `firstEventMs` 重叠，四段之和大于总耗时）。按项目约定不回填历史记录，
  老记录缺字段按未知处理、`userTurn` 缺失按 0 归一组。
- …

### 修复
- …

## [0.1.0] - 2026-09-29

### 新增
- …
```

**分节用词**：新增 / 变更 / 修复 / 移除。不用「优化」「调整」这类模糊词，归入最接近的一节。

**版本号**：跟随根 `package.json` 的 `version`。改动流程状态时 bump 并落成 `## [x.y.z] - YYYY-MM-DD`，
未发布的累积改动留在 `## [未发布]`。

**规模上限**：主文件要能一次 `read` 读完（工具是 50KB / 2000 行截断），所以四道线都卡住——未发布 ≤ 40 条、
单个已发布版本的摘要 ≤ 16 条、版本段 ≤ 4 个（未发布 + 最近 3 个已发布版本）、全文 ≤ 45KB。越线的动作
只有一个方向：把内容移出主文件。

- 未发布到 40 条：落版，并按下面的归档规则把明细移走。
- 落版时：主文件只留摘要（≤ 16 条，写「本版做了什么」而不是逐条抄）与一行链接。
- 超 4 个版本段或超 45KB：把最老的已发布版本整段（含摘要）也移进归档，原位置只留链接行。

**归档规则**：明细整体移入 `docs/changelog/<YYYY>.md`（按发布年份，同年合并、版本倒序），
主文件保留「未发布」+ 最近 3 个已发布版本段，更早的只留一行链接。四道上限由
`scripts/verify/checks/changelog.ts` 兜底，越线会让 `pnpm check` 失败。本约定启用前已发布的 `0.2.0` /
`0.1.0` 不回溯搬运——它们是历史段落，原文留在主文件。

## [未发布]

### 新增

- `pnpm check:fast`：中途收窄的校验入口——biome 只查工作区改动的文件 + 全部包 typecheck + 约定校验，
  跳过测试（实测约 11 秒；全量 `pnpm check` 约 22 秒）。不用 biome 自己的 `--changed`：它比的是**已提交**
  的改动（同 `--since` 给的提交点），中途要检查的正是没提交的那些。
- `scripts/verify` 新增 `changelog` 校验项：未发布段的小节名唯一且按 `新增 → 变更 → 修复 → 移除` 排、
  版本号格式与倒序、引用的归档文件存在，以及顶部新写的四道规模上限（未发布 40 条 / 单版摘要 16 条 /
  版本段 4 个 / 全文 45KB）——超限即失败并指明该怎么归档。追加条目时「新开一节」会让同名小节重复，
  攒着不落版又会让主文件长到一次 `read` 读不完，两者都拦在结构上。
- `pnpm verify -- --only <项名>`：只跑指定检查项（如 `--only changelog,i18n`），缺省仍全跑。

### 变更

- `AGENTS.md` 的验证与走查口径收紧：「一轮只跑一次」从段落提进验证命令表并补上 `pnpm check:fast`；
  数值微调改用 `agent-browser eval` 读计算值，不截图、不重开页面；`wait` 只用在已确认存在的元素上，
  「操作」与「测量」分两段发，不用 `&&` 绑死。
- `docs/design-surfaces.md` 去掉对组件内部实现的复述（编辑器列表的类名串、`InputSearch` 的内部控制、
  目录条与表格重复的档位）；判据与档位规格保留。
- `plans/browser-tools.md` 把「不做自动等待」的操作口径写进工具描述的要求里：`wait` 只用在与已确认
  存在的元素上，操作与测量不串成一条命令。

### 修复

### 移除

## [0.3.0] - 2026-10-14

0.2.0 之后的开发累积，共 342 条（新增 88 条 / 变更 196 条 / 修复 46 条 / 移除 12 条），
明细整体归档在 [docs/changelog/2026.md](docs/changelog/2026.md)。主线：

- **插件平台**：契约与宿主内核、登记表与装配、内置与第三方市场、hooks 注入、插件变量与插件 MCP、
  项目级作用域（只做开关）。
- **工作台**：VSCode 式的活动栏 + 侧栏 + 编辑器区、文件树与文件预览、改动与历史、标签条。
- **助手模式与权限**：目标模式收口、三处等用户决策统一成决策面板、只读模式与权限档位口径。
- **外观与设计系统**：设计 token 四层、反色面 token 对、外观参数（字号 / 密度 / 字体）、配色主题机制。
- **会话与上下文**：会话条目登记表与校验、压缩触发点、会话标题并行生成、步级耗时归因与用量统计。
- **平台与工程**：Windows / Linux 纳入目标平台、`@ucode/ui` 按域重排与公开面收口、桌面端改同源、
  `scripts/verify` 的校验项补齐。
- **工程流程**：变更日志改为「发布时明细整体入 `docs/changelog/<年份>.md`，主文件只留摘要与链接」，
  明细不再堆在 `[未发布]` 里。

## [0.2.0] - 2026-09-29

### 新增

- 新增 `packages/contracts`（`@ucode/contracts`）：接口请求校验（zod）、响应类型、统一封套与跨端常量的单一事实源，
  server 与 web 共用同一入口（前端允许引到 zod，不再为隔离它拆子路径）。
- server 新增日志模块 `platform/logger`（pino，开发期 `pino-pretty`）与请求日志中间件 `requestLogger`。
- server 新增 `utils/`（纯函数）与 `constants.ts`（默认值与固定目录名）；新增 `APP_LOG_LEVEL` 环境变量。
- 引入 Biome 作为格式化与 lint 入口（`biome.json`），根脚本新增 `pnpm check`
  （`biome check .` + `pnpm -r typecheck`，作为强制校验入口）与 `pnpm format`。
- 添加 `AGENTS.md`：开发边界、提交流程、注释与编码约定、验证命令、目录约定、生成代码豁免与安全规则。
- 添加本文件。

### 变更

- server 目录：`pi/` 更名 `core/`；`lib/` 收敛为服务端基建（`response` / `validate` / `logger`），
  并与 `routes/` 一样要求一级使用文件夹；路由改为 `routes/<domain>/index.ts`。
- 环境变量统一 `APP_` 前缀：`PI_WORKSPACE_DIR` / `PI_AGENT_DIR` / `PI_DATA_DIR` 合并为主目录 `APP_HOME`
  （工作目录、配置与 `agent/` 全由它派生），`PORT` → `APP_PORT`、`POOL_IDLE_MS` → `APP_POOL_IDLE_MS`、
  `CORS_ORIGIN` → `APP_CORS_ORIGIN`。
- 接口出参统一为 `{ success, code, message, data }`：成功 `code: "ok"`，失败沿用字符串错误码并保留语义化
  HTTP 状态，错误详情放 `data`；请求参数一律进 body。
- `POST /api/v1/messages/send` 重命名为 `POST /api/v1/messages/prompt`。
- `health` 响应字段 `model` 改为 `defaultModel`，与其它接口保持一致。
- `config/info` / `config/update` 不再下发 provider 级 `headers`（可能含鉴权信息），与 `ProviderConfigView` 的声明对齐。
- web 的类型定义与接口封装改为引用 `@ucode/contracts`，删除本地重复定义；`sendMessageStream` 更名 `promptStream`。
- server 响应生产点补齐契约类型的显式标注 / `satisfies`，契约字段变更会直接编译失败（响应体不再停在推断状态）。
- 按 Biome 规则统一现有源码的排版与 import 顺序，清理未使用导入、非空断言与表达式内赋值；
  新增 `@biomejs/biome` 根开发依赖。

### 移除

- 移除 server 内重复的契约定义（`lib/schemas.ts`、`config/schema.ts`）与 `hono/logger`，日志统一走 pino。

## [0.1.0] - 2026-09-29

### 新增

- 初始化 pnpm workspace（`server/` + `apps/web/`），根脚本 `dev` / `build` / `start` / `typecheck` / `smoke`。
- `server/`：Hono + TypeScript，端口 2048，接口前缀 `/api/v1`（`health` 之外全 `POST`）——
  会话列表 / 详情 / 重命名 / 删除、历史、发送（SSE 流式，含 thinking 与 tool call 增量）、中断。
- `server/`：pi SDK 封装——`ModelRuntime` 单例与热重载、`AgentSession` 池（同会话串行 + 空闲回收）、
  复用 pi 的 JSONL 会话持久化；模型 / 端点 / API Key 走运行时配置而非 `.env`。
- `apps/web/`：Vite + React 19 + Tailwind v4 + shadcn/ui 对话界面（会话侧栏、消息流、工具调用卡片、
  模型设置），生产模式由 server 同源托管。
