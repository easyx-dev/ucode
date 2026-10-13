# ucode

把 [pi](https://pi.dev) 编码 agent（`@earendil-works/pi-coding-agent`）封装成 HTTP 服务，并配一个 Vite + React + shadcn/ui 的对话界面。

- **server/**：Hono + TypeScript，端口 `19688`，全部接口前缀 `/api/v1`（`health` 之外都是 `POST`）
- **apps/web/**：Vite + React 19 + Tailwind v4 + shadcn/ui，开发时跑 `5173`，生产由 server 同源托管
- **apps/desktop/**：Electron 桌面端，自带 Vite + React 渲染层，复用 `@ucode/ui` 与 `@ucode/sdk`；主进程读
  `$APP_HOME/app/service.json` 免登录连接本机服务（凭证只留在主进程）
- **packages/contracts/**：`@ucode/contracts`，接口的请求校验与响应类型，server 与 web 共用同一份定义
- **packages/brand/**：`@ucode/brand`，品牌名与 logo / favicon 的单一来源，B 端定制只改这里
- 会话正文沿用 pi 的 JSONL；`$APP_HOME/app/app.db`（SQLite）保存应用自己的会话元数据与索引

项目规范：设计系统见 [`DESIGN.md`](./DESIGN.md)，界面规格与数据库 / 接口 / 组件规范见 [`docs/`](./docs)；
仓库级约定与验证命令见 [`AGENTS.md`](./AGENTS.md)。

---

## 快速开始

```bash
pnpm install

# 开发：server(19688) + web(5173) 一起启动
pnpm dev

# 生产：构建后用 19688 一个端口
pnpm build && pnpm start

# 桌面端：先起 server，再单独起 Electron
pnpm dev:desktop        # 开发：渲染层走 vite dev server（:5174），连开发实例
pnpm start:desktop      # 生产：构建后由 Electron 直接加载产物（不起渲染层服务），连生产实例
```

打开 `http://localhost:19688`（生产）或 `http://localhost:5173`（开发）。首次启动会生成登录密码并打印在启动日志里（也可查看 `$APP_HOME/app/service.json`），用密码登录后即可使用。

首次启动会提示「尚未配置模型」，点侧栏底部 **设置** 或调用 `POST /api/v1/config/update` 填入端点即可。

### 生产启动与自迭代

生产启动是「先构建、再跑产物」：`pnpm build` 把 web 构到 `apps/web/dist`，再由 esbuild 把
server 打成单文件 `dist/ucode.js`，`pnpm start` 即 `NODE_ENV=production node dist/ucode.js`。
主要用途之一是**用 ucode 开发 ucode**：`node dist/ucode.js` 不被 watch，编辑源码不会重启它，
只在你显式重启时才生效——避开开发环境存盘即重启打断会话的问题。

```bash
pnpm build                         # 构建 web + server 产物
pnpm start                         # 前台启动（默认 19688）
pnpm build && pnpm start -- --restart   # 重建后端到端重启：停旧实例 → 起新版本
```

`pnpm start` 后的参数原样透传给 `server/src/cli.ts`：

```bash
pnpm start -- --port 0        # 自选可用端口
pnpm start -- --open          # 启动后打开浏览器
pnpm start -- --status        # 只查询是否在运行（运行中退出码 0）
pnpm start -- --restart       # 结束注册文件里的旧实例后再启动
```

- 产物运行时从**仓库根**的 `node_modules` 解析第三方依赖（esbuild 里设为 external），
  故根 `package.json` 的 `dependencies` 必须覆盖 `server` 的第三方运行时依赖——由 `scripts/verify`
  的 `manifest` 校验兜底。
- 生产（`NODE_ENV=production`）读 **`.env.prod`**（模板 `.env.prod.example`），从 cwd 向上查找；
  `.env.prod` 声明 `APP_HOME=~/.ucode`、端口 `19688`，与开发（`.env` → `.tmp/.ucode`）的数据目录隔离。
  缺失必需项会直接报错退出，代码不带默认值。
- 需要 Node ≥ 24（`node:sqlite`）。全局命令 / npm 包 / 安装包分发尚未做，留待发布阶段。

### 桌面端（Electron）

`apps/desktop` 是独立客户端，当前有 dev 与生产（跑构建产物）两种运行方式（不做安装包、不拉起服务），
只连**已运行**的本机服务（按启动时的 `NODE_ENV` 选择连开发还是生产实例）：

- 渲染层来源：开发时由 `:5174` 的 Vite dev server 提供（启动脚本声明 `DESKTOP_RENDERER_URL`，改代码即时生效）；
  生产形态由 Electron 以应用内协议 `app://desktop/` 加载构建产物：页面与接口同源，不起渲染层服务。
- 窗口：macOS 去掉系统标题栏，系统红绿灯也一并隐藏，改由界面自绘三颗窗口控件（关 / 最小化 / 全屏，
  ⌥ 点击绿点是最大化 / 还原，`windowControl` IPC）；
  控件挂在**覆盖它的那条拖拽区**里（展开时是侧栏顶部、收起时是对话区头部；`no-drag` 只对同一子树生效，
  挂成兄弟子树就会被拖拽区吃掉点击），中线由布局实测；悬停露出操作符号，窗口失焦置灰，
  标题条在失焦时也一次点得动（`acceptFirstMouse`）。详见
  [`docs/design-surfaces.md`](./docs/design-surfaces.md)「应用骨架」。其他平台保留系统边框与系统控件。
- 界面：自带 Vite + React 渲染层，复用 `@ucode/ui` 的组件与 `@ucode/sdk`；会话 / 设置状态只在本窗口内（不走 URL）。
- 免登录且无跨域：主进程读 `$APP_HOME/app/service.json` 拿 `serviceToken`，渲染层的 `/api/*` 与页面同源——
  生产由 `app://` 协议处理器转给服务并注入 `Authorization: Bearer`（fetch / SSE / 附件图片都经此），
  开发由 Vite 代理转发、令牌仍由主进程加在请求头上。**凭证不进渲染层，也不需要服务端为桌面端开 `APP_CORS_ORIGIN`。**
- 启动：先起服务，再按场合二选一——开发用 `pnpm dev` + `pnpm dev:desktop`，生产用 `pnpm start` + `pnpm start:desktop`
  （后者先构建桌面端，再由 Electron 加载产物）。`start:desktop` 带 `NODE_ENV=production`，即读 `.env.prod`
  的 `APP_HOME`（`~/.ucode`），故连的是生产实例；`dev:desktop` 读 `.env`，连开发实例。
- **Electron 二进制**：`electron` 依赖的安装脚本会去 GitHub Releases 拉一份运行时（约 120MB），
  安装时被跳过、或网络到不了 release 资产时会停在 `Downloading Electron binary...`。补装：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node apps/desktop/node_modules/electron/install.js`。
- 调试：开发形态自动独立开一窗 DevTools（`⌘⌥I` 或 `F12` 随时收回 / 再唤出），生产形态不开。

> 尚未做：安装包（内置服务运行时）、服务发现与自动拉起、按 `compatRange` 的版本兼容决策；留待打包阶段。

### 环境变量（`.env` / `.env.prod`）

配置项一律由环境变量声明，**代码不带默认值**——缺失或非法即启动报错。按 `NODE_ENV` 选择文件：
`pnpm dev` 与测试读 `.env`（开发），`pnpm start` 读 `.env.prod`（生产）；两者都从 cwd
向上查找，模板见 [`.env.example`](./.env.example) 与 [`.env.prod.example`](./.env.prod.example)
（`.env` / `.env.prod` 为本地文件，不入库）。
**模型 / 端点 / API Key 不在这里**，而是通过接口写入 `$APP_HOME/app/config.json`：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `APP_HOST` | 是 | 监听地址**默认值**；仅回环，`0.0.0.0` 允许局域网（显式开启并告警）。可被 `--host` 或设置里的开关覆盖 |
| `APP_PORT` | 是 | HTTP 端口**默认值**；`0` 表示自选可用端口，启动后写回 `service.json`。可被 `--port` 或注册文件里的值覆盖 |
| `APP_HOME` | 是 | 配置 / 数据主目录：`harness/`、`app/`、`workspace/`、`skills/`、`prompts/`、`agents/` |
| `APP_POOL_IDLE_MS` | 是 | 内存中的 AgentSession 空闲多久后回收（毫秒） |
| `APP_LOG_LEVEL` | 是 | pino 日志级别（`trace`…`silent`） |
| `APP_PROMPT_SOURCE` | 是 | 系统提示词源：`custom`（整段自研）/ `pi`（pi 默认 + 自研片段），改后重启生效 |
| `APP_CORS_ORIGIN` | 否 | 允许的跨域来源，逗号分隔；缺省不放行跨域（同源与原生客户端不需要 CORS） |

> `APP_HOST` / `APP_PORT` 是**默认值**，取值顺序按「有没有其它入口」区分：
> **`APP_HOST`**：显式设置（`--host` 参数或启动前就有的环境变量）> `$APP_HOME/app/service.json`
> （设置里的「局域网访问」开关写在这里）> `.env(.prod)` 默认值——开关改完重启即生效。
> **`APP_PORT`**：显式设置（`--port` 或启动前环境变量）> `.env(.prod)`；端口没有设置入口，故以 env 为准，
> `service.json` 仅在未声明时兜底。改端口只需改 `.env(.prod)`，无需删注册文件。

> `APP_HOME` 支持 `~`（展开为用户主目录）与相对路径（相对环境文件所在目录）；
> 开发模板用仓库内 `.tmp/.ucode`，生产用 `~/.ucode`，两者数据隔离。

`APP_HOME` 派生出的路径（无需单独配置），按「谁的资产」分两层：

```
$APP_HOME/                 # 默认 ~/.ucode
├── harness/               # 运行时私有：auth.json / sessions/
├── app/                   # 应用自有：config.json / service.json / app.db（SQLite）
├── skills/                # 全局技能：<id>/SKILL.md
├── prompts/               # 全局命令（提示词模板）：<name>.md
├── agents/                # 全局自定义角色：<slug>.md（primary / subagent）
└── workspace/<sessionId>  # 未绑定目录的会话的工作目录
```

命令 / 技能还支持项目级目录 `<cwd>/.ucode/{skills,prompts}`，自定义角色支持 `<cwd>/.ucode/agents`
（均沿 cwd 祖先链收集，止于项目根）；技能另有兼容目录 `.agents/skills`。
同名优先级：项目 `.ucode` > 项目 `.agents/skills` > 全局 `$APP_HOME` > 用户 `~/.agents/skills`。

配置 = `$APP_HOME/app/config.json`、harness 目录 = `$APP_HOME/harness`（`auth.json` / `sessions/`）、
会话元数据与索引 = `$APP_HOME/app/app.db`。
会话的工作目录：绑定目录的用那个目录，未绑定的用 `$APP_HOME/workspace/<sessionId>`。

> SQLite 用 Node 内置的 `node:sqlite`（`DatabaseSync`），需要 **Node ≥ 24**；它是实验特性，启动时会打印一条 `ExperimentalWarning`，不影响使用。

> agent 具备 `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls` 工具与自研的
> `webfetch` / `websearch`，实际执行范围就是 `APP_HOME`，默认 `~/.ucode`。想让它改真实代码仓库，把它指向目标目录。

---

## 品牌定制

品牌名、浏览器标题与 logo / favicon 统一放在 `packages/brand/`（`@ucode/brand`），B 端交付只改这一处：

- `src/brand.ts`：`name`（侧栏、空态水印）、`title`（浏览器标题）、`slug`（主题存储键、默认数据目录等命名空间）
- `src/assets.ts`：`logoLight` / `logoDark` / `favicon` 三个图片引用，从 `assets/` 下的文件 import；
  换 logo 就替换文件，换格式就改这里的 import 扩展名（svg / png / jpg / webp … 都行）；
  只想要一套通用的 logo 时，把 `logoLight` / `logoDark` 指向同一个文件即可
- 标题与主题存储键由 `@ucode/brand/vite` 的 `brandHtml` 插件在构建时注入 `index.html`，避免首屏闪烁
- 默认数据目录名由 `slug` 派生（`~/.<slug>`，默认即 `~/.ucode`）

改完跑 `pnpm check`：其中的 brand 校验会检查品牌值合法、资源齐备，并拦下源码里残留的硬编码品牌名。历史遗留或不在品牌包覆盖范围内的文件，可用应急脚本批量矫正：

```bash
# 预演（默认不落盘）
node packages/brand/scripts/replace.ts --from 旧品牌 --to 新品牌
# 落盘；--paths 指定范围，--regex 让 --from 按正则解释
node packages/brand/scripts/replace.ts --from 旧品牌 --to 新品牌 --write
```

---

## 模型配置

配置持久化在 `$APP_HOME/app/config.json`，通过接口或界面管理，保存后自动重建 pi 的 `ModelRuntime`（内存中的会话会被丢弃，历史文件不受影响）。

### 接入 pi 内置供应商（推荐）

pi 自带一份供应商目录（`pi-ai` 的 `providers/all`）。设置页的「添加供应商」会列出其中
**可用一把 API key 直接接入**的那些（32 个：deepseek / minimax / zai / kimi-coding / xiaomi / qwen-token-plan /
openai / anthropic / xai / openrouter / google / groq / mistral / together …），选中后只需填 apiKey。

这类条目在 `config.json` 里**只记 `id` 与 `apiKey`**，端点与模型清单都由 pi 提供：

```jsonc
{ "providers": [ { "id": "deepseek", "api": "openai-completions", "apiKey": "sk-..." } ] }
```

好处是 pi 升级（新增模型、调整上下文窗口）会自动生效，不用重配。

以下两类不在此列，需要显式配置：端点为 null（随凭证解析，如 `amazon-bedrock` / `google-vertex` /
`cloudflare-*` / `azure-openai-responses` / `opencode`）与只有 OAuth 的（`openai-codex`）。
它们的凭证也可以直接来自环境变量（如 `DEEPSEEK_API_KEY`），此时目录里会显示为已接入。

### 自定义供应商

pi 不认识的端点用「添加自定义供应商」，必须同时给出 `baseUrl` 与 `models`：

```bash
curl -X POST http://localhost:19688/api/v1/config/update \
  -H 'content-type: application/json' \
  -d '{
    "providers": [{
      "id": "local",
      "name": "Local Gateway",
      "baseUrl": "http://localhost:8317/v1",
      "api": "openai-completions",
      "apiKey": "devtest",
      "models": [
        { "id": "deepseek-v4-flash", "name": "DeepSeek V4 Flash", "reasoning": true },
        { "id": "glm-5.2", "name": "GLM 5.2", "reasoning": true }
      ]
    }],
    "defaultModel": "local/deepseek-v4-flash"
  }'
```

自定义供应商也可以给 `models` 覆盖内置供应商的模型清单——**一旦给出即为整体替换**（不是按 id 合并），
此后该供应商不再跟随 pi 内置目录更新。

### 本项目开发时用的测试端点

| 项 | 值 |
| --- | --- |
| baseUrl | `http://localhost:8317/v1` |
| api | `openai-completions` |
| apiKey | `devtest` |
| 可用模型 | `deepseek-v4-flash`（推荐）、`deepseek-v4-pro`、`glm-5.2`、`kimi` |

已实测该端点支持：SSE 流式、`tool_calls`、`reasoning_content`、`reasoning_effort`。

**注意**：这个网关不接受 `role: "developer"`（部分自建/代理网关的常见限制），
所以服务把 provider 与模型注入 pi 的 `ModelRuntime` 时，默认给每个模型补上
`"compat": { "supportsDeveloperRole": false }`，让 pi 改用 `system` role。
如果换成官方 OpenAI 端点且想用 `developer`，在设置里把该模型的 `compat` 覆盖掉即可。

### 连通性测试

```bash
curl -X POST http://localhost:19688/api/v1/config/test \
  -H 'content-type: application/json' \
  -d '{"baseUrl":"http://localhost:8317/v1","apiKey":"devtest","model":"deepseek-v4-flash"}'
```

（只支持 `openai-completions`。）

### 模型字段（对应 pi 的 `Model`）

`provider.models[]` 的常用字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `id` | 必填 | 模型 id |
| `name` | = `id` | 显示名 |
| `api` | provider 级值 | 覆盖该模型的 API 格式 |
| `baseUrl` | provider 级值 | 覆盖该模型的端点 |
| `reasoning` | `false` | 是否支持思考，配合 `thinkingLevel` |
| `thinkingLevelMap` | 厂商默认 | pi 的 7 档 `off`…`max` → 厂商取值；`null` 表示该档不支持 |
| `input` | `["text"]` | 支持的输入类型（`text` / `image`） |
| `inputLimits` | 无 | 请求体积上限与图片缩放 / 每消息 / 每请求上限 |
| `contextWindow` | `128000` | 上下文窗口 |
| `maxTokens` | `8192` | 最大输出 |
| `cost` | 全 0 | 计价；`tiers` 支持按输入 token 分档 |
| `promptCache` | 无 | 提示缓存时长（`short` / `long`） |
| `samplingParams` | 无 | 该模型的默认采样参数，单次请求可覆盖 |
| `headers` | 无 | 该模型的请求头 |
| `compat` | `{ supportsDeveloperRole: false }` | pi 的 `*Compat` 开关，按 `api` 收窄，原样透传 |

`thinkingLevel` 取值与 pi 一致：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`。
会话的档位是**偏好**：输入区右下角选「自动」（默认）即按本会话模式的推荐档位跑
（`plan` = `max`、`build` = `xhigh`、`ask` = `medium`，见 `server/src/harness/setup/agents/profiles.ts`），
选了具体档位就以会话的为准。

---

## 联网搜索

agent 有自研的 `webfetch`（抓链接转 markdown）与 `websearch`（联网搜索，只给标题 / 链接 / 摘要）两个工具。
`websearch` 需要一家搜索服务商，配置与模型同放 `$APP_HOME/app/config.json`，
也可以在设置的「联网搜索」页里改。

| provider | 门槛 | 鉴权 / 地址 |
| --- | --- | --- |
| `tavily`（默认） | 注册即用，免费档 1000 次/月、**不用绑卡** | `Authorization: Bearer tvly-…` |
| `searxng` | **完全免费、无需注册**，但要自己跑一个实例 | `baseUrl`，如 `http://localhost:8888` |
| `brave` | 2026-02 起新人只剩 $5/月赠金，**要绑卡** | `X-Subscription-Token` |

三家都需要在 `config.json` 里配：key 型填 `apiKey`，自建实例填 `baseUrl`。

```jsonc
{ "websearch": { "provider": "tavily", "apiKey": "tvly-..." } }
```

```bash
curl -X POST http://localhost:19688/api/v1/config/update \
  -H 'content-type: application/json' \
  -d '{"websearch":{"provider":"tavily","apiKey":"tvly-..."}}'
```

**自建 SearXNG**（无 key、无额度限制、查询不出本机）。注意它**默认只开 HTML 输出**，
而 `websearch` 走的是 JSON 接口，所以要挂一份开了 `json` 的 `settings.yml` 进去：

```bash
mkdir -p searxng
cat > searxng/settings.yml <<'YAML'
use_default_settings: true
server:
  secret_key: "换成你自己的随机串"
search:
  formats:
    - html
    - json
YAML
docker run -d --name searxng -p 8888:8080 -v "$PWD/searxng:/etc/searxng" searxng/searxng:latest
```

验证（`200` 表示 JSON 已开，`403` 说明 `search.formats` 里还没有 `json`）：

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:8888/search?q=test&format=json'
```

然后把设置页的「搜索服务商」选成 SearXNG、实例地址填 `http://localhost:8888` 即可（地址必须带 `http://` 或 `https://`）。

- `apiKey` 留空表示沿用已保存的 key；没配好前置条件时 `websearch` 不会崩，只返回一条可读错误。
- `webfetch` 不需要任何配置，但只抓公网地址：回环、私网与链路本地（含云元数据 `169.254.169.254`）一律拒绝，
  重定向逐跳校验；正文最多 5MB，交给模型的正文再按 50KB 截断。
- 抓到的内容以 `<fetched>` / `<search_results>` 包起来，提示模型那是外部数据而非指令。

---

## 会话模式与权限

会话模式（`build` / `plan` / `ask`，或自定义 primary agent）决定工具声明与提示词倾向；只读模式
（`plan` / `ask`）的声明与编码一致，靠权限规则在调用时阻断写盘与执行——这样切模式不会改变模型的工具表。
会话权限档位（`default` / `auto` / `full`）只决定命中 `ask` 时弹审批还是自动放行，
**不改变工具声明、也不突破 `deny`**（`.env` 阻断、只读模式的写 / 执行阻断在任何档位都生效）。
档位是会话属性，入口在输入区底部工具栏。

完整语义（权限引擎与默认规则、越界目录、技能目录与 MCP 兜底、审批与「本会话恒允」、安全边界、
档位与新建 / 分叉 / 子会话的关系）见 [`docs/modes-and-permissions.md`](docs/modes-and-permissions.md)。

---

## HTTP 接口

统一响应体：`{ "success": true, "code": "ok", "message": "", "data": ... }`；
失败为 `{ "success": false, "code": "invalid_request", "message": "...", "data": <详情> }`（HTTP 状态仍保留语义，如 400 / 404 / 409）。
除 `GET /api/v1/health` 外，所有接口都是 `POST` + JSON body，参数一律放在 body、不出现在路径里。
请求校验与响应结构定义在 `@ucode/contracts`（`packages/contracts/`），web 直接引用同一份类型。
失败响应带 `code` + 中文兜底 `message` + 插值 `params`，客户端按 `code` 渲染当前语言（见 `docs/api.md`「语言与本地化」）。

逐个接口的**请求参数与响应结构**见自动生成的 [`docs/api-reference.md`](docs/api-reference.md)
（由 `pnpm api:docs` 从 `packages/contracts/` 生成，`pnpm check` 校验其与契约一致）。

### 全局事件流

生成与连接是解耦的：`messages/prompt` 只负责投递，事件统一从 `POST /api/v1/events` 推送。

```bash
curl -N -X POST http://localhost:19688/api/v1/events \
  -H 'content-type: application/json' -d '{}'
```

SSE 的事件名固定为 `message`，真正的类型在 `data` 的 JSON 里：

- 会话事件帧：`{ type, sessionId, seq, data }`，`type` 取自 `EVENT_NAMES`，`seq` 是会话内单调序号
- 控制帧：`{ type: "server.connected" }`、`{ type: "error", sessionId?, code, message }`
- 心跳为 `: heartbeat` 注释行（15s）

接续方式：先取 `messages/list` 快照（响应里的 `seq` 表示「已包含到该序号为止的全部效果」），
再连 `/events`，丢弃 `seq <= 快照 seq` 的帧。刷新或断线重连后重复这套流程即可，不会丢在途内容。

| 事件 `type` | data | 说明 |
| --- | --- | --- |
| `message_start` | `{ role }` | 新一轮消息开始 |
| `text_delta` | `{ delta }` | 正文增量 |
| `thinking_delta` | `{ delta }` | 思考增量 |
| `tool_call` | `{ toolCallId, toolName, args }` | 模型请求调用工具 |
| `tool_start` / `tool_update` / `tool_end` | `{ toolCallId, toolName, text?, isError? }` | 工具执行过程 |
| `message_end` | `MessageDTO` | 权威消息（前端用它替换流式内容） |
| `queue_update` | `{ steering, followUp }` | 生成中排队情况 |
| `compaction_start` / `compaction_end` | `{ reason? }` | 上下文压缩 |
| `session_created` | `SessionSummary` | 新建 / 分叉 / 子智能体创建 |
| `session_updated` | `{ session: SessionSummary, usage?, contextUsage? }` | 改名 / 换模型 / 落定后摘要刷新 / 运行态变化 |
| `session_archived` | `{ sessionId }` | 归档（级联子会话逐个下发） |
| `agent_settled` | `{}` | 本次运行结束 |

控制帧（无 `sessionId` / `seq`）：`server.connected`、`{ type: "error", sessionId?, code, message, params? }`、
`{ type: "config_changed", config }`（配置重建）、`{ type: "mcp_changed", mcp }`、`{ type: "projects_changed", projects }`。

`MessageDTO`：

```ts
{
  id: string
  role: "user" | "assistant" | "tool" | "custom" | "summary"
  blocks: Array<{ type: "text"; text } | { type: "thinking"; text } | { type: "toolCall"; id; name; args }>
  model?, toolCallId?, toolName?, isError?, createdAt?   // createdAt 为 ISO 8601 UTC
}
```

`toolCallId` 只在 `role: "tool"` 上出现，用于和 assistant 的 `toolCall.id` 对应（pi 默认并发执行工具调用，前端需要精确匹配而不是按顺序猜）。

### 生成中继续发消息

`messages/prompt` 默认不会占用「会话锁」（只有创建 `AgentSession` 那一步串行），所以并发请求是安全的：

- 会话空闲时 → 直接开启新一轮（`prompt`）。
- 会话正在生成时 → 按 `behavior` 投递：`"follow-up"`（默认）在当前这一轮（含工具调用）结束后处理；`"steer"` 在当前 assistant turn 的工具调用执行完之后、下一次 LLM 调用之前插入。投递后会先发 `queue_update` 事件，然后继续推流直到会话重新空闲。
- 极端竞态下（占用者刚结束）会退化成新的一轮；若连占位都拿不到，返回 `409 session_busy`。

---

## 结构

```
DESIGN.md                  # 设计系统（token 体系 / 外观参数 / 颜色与排版口径）
.env.example               # 开发环境变量模板（复制为 .env）
.env.prod.example          # 生产环境变量模板（复制为 .env.prod）
docs/
  database.md              # 数据库规范
  api.md                   # 接口与字段规范
  api-reference.md         # 接口参考（由 pnpm api:docs 生成，勿手改）
  components.md            # 组件规范
  design-surfaces.md       # 界面规格（三栏骨架 / 消息区 / 输入区 / 工作台 / 设置）
scripts/api-docs/          # 接口参考生成器（endpoints 清单 + 生成 + 校验）
scripts/verify/            # 约定校验（migrations / contracts / api-docs / tokens / design / themes / brand / i18n / manifest），由 pnpm check 调用
scripts/build-cli.mjs      # esbuild 把 server + CLI 打成 dist/ucode.js（供 pnpm start 运行）
packages/contracts/
  src/
    envelope.ts            # { success, code, message, data } 封套与错误码
    constants.ts           # API_VERSION / API_TYPES / THINKING_LEVELS / MESSAGE_ROLES
    locale.ts              # LOCALES / Locale / DEFAULT_LOCALE / isLocale
    common.ts              # emptyInputSchema、ListResult、SessionScoped
    runtime.ts             # RuntimeStatus
    events.ts              # 事件名与帧结构
    health/output.ts
    {models,sessions,messages,config}/{input,output}.ts
packages/brand/
  src/brand.ts             # 品牌唯一入口：name / title / slug（B 端定制只改这里）
  src/assets.ts            # logoLight / logoDark / favicon 的图片引用（换格式改这里的 import）
  assets/                  # logo-light.svg / logo-dark.svg / favicon.svg
  scripts/verify.ts        # 品牌校验（品牌值 / 图片引用 / 硬编码品牌名）
  scripts/replace.ts       # 应急：批量替换残留的旧品牌串
packages/i18n/             # 跨端 i18n 运行时与共享文案（只依赖 i18next）
  src/index.ts             # createI18n / 共享目录，不导出全局单例
  src/config.ts            # house i18next 配置（key 即文案，无 key / ns 分隔符）
  src/error-messages.ts    # ERROR_CODES → 文案 key（客户端按 code 渲染错误）
  src/locales/common/      # 协议级通用文案（中英）
  src/locales/domain/      # 错误码文案（中英）
  src/locales/ui/          # 产品界面文案（web / Electron / TUI 共用，中英）
packages/sdk/              # @ucode/sdk：server /api/v1 的跨端客户端（无 React / DOM）
  src/apis.ts              # createApis：按域组装的接口方法（无状态）
  src/transport.ts         # 封套拆解、baseUrl / token 注入与自定义头
  src/events.ts            # 事件流：指数退避重连与 onEvent / onError 订阅
  src/stores/              # 各域同步 store（会话列表、消息流、交互、目标、配置…）
  src/client.ts            # createClient：apis + events + 各域 store
packages/ui/               # @ucode/ui：web 与桌面端共享的 UI
  src/base/                # 基础组件（shadcn 生成后归我们维护）
  src/business/            # 业务组件（侧栏、消息区、Composer、设置…）
  src/hooks/               # SDK store 的 React 绑定与派生
  src/lib/                 # 纯逻辑（类型出口、消息归并、草稿、格式化…）
  src/provider/            # UiProvider：注入应用层创建好的 client
  src/presets/workspace-layout.tsx  # 预置组合（侧栏 + 对话 + 输入 + 对话框）
  src/styles/theme.css     # 设计 token、base 层与 markdown 样式
  components.json          # shadcn CLI 配置
server/src/
  cli.ts                   # 命令行入口：参数解析 / --restart / --status / --open，再交给 index
  env.ts                   # 环境变量解析：定位并加载 .env(.prod)、取值校验、派生全部路径
  app.ts                   # createApp：中间件、鉴权、路由挂载、静态托管
  main.ts                  # 入口：服务注册、监听端口、优雅退出
  constants/               # 常量按域拆文件：dirs / session / tools / agents / attachments / memory / title / goal / auth / env
  config/                  # config.json：读写、变更分级、模型能力与目录
  db/                      # SQLite（node:sqlite）：连接、user_version 迁移、各表仓储
  core/                    # 内核·会话运行态：持有实例，管一轮怎么跑
    pool.ts                # sessionId -> AgentSession 池、按会话串行、空闲回收
    run-tracker.ts         # 一轮的占位与收尾顺序
    recycle.ts             # 配置变更时的回收计划（空闲立即回收 / 活跃标脏）
    event-bus.ts           # 会话事件总线（/events 的唯一数据源）
    events.ts              # AgentSessionEvent -> 对外帧
    interactions.ts        # 权限审批 / 提问的挂起与结算
    session-paths.ts       # 会话工作目录口径
    workspace.ts           # 会话工作区目录（$APP_HOME/workspace/<id>）
    session-status.ts      # 状态口径；session-summary.ts 是摘要 DTO 口径
  harness/                 # 基于 pi 的能力
    pi/                    # 与 pi 的数据 / 对象互转：runtime / serialize / records / session-index 等
    setup/                 # 一次装配所需的全部：角色、权限、工具、提示词、MCP、命令技能、预算
    features/              # 会话跑起来后的能力：goal / memory / title / usage / subagents / shell 等
    utils/                 # harness 内的公共方法：取消息文本、不可信内容的边界包裹
  services/                # 业务与胶水：用例编排、进程生命周期（域目录一律文件夹，仅 index.ts 除外）
    index.ts               # Services 装配（routes 只依赖它）
    lifecycle/             # 启动对账、定时清理、退出收尾
    config/                # 配置用例：applyConfig / reload
    auth/ projects/ sessions/ files/ git/  # 鉴权、项目偏好、会话用例、文件读取、只读 git
  platform/                # 进程基建：response / validate / logger / version / paths / resources / service-registration
  utils/                   # 跨模块通用的纯函数（object / time）
  routes/                  # HTTP 域：health / models / config / sessions / messages / events / …
  scripts/                 # 不经 HTTP 的冒烟与评测
    smoke.ts               # pi SDK 直连模型端点
    eval.ts                # 提示词评测：真实模型跑固定用例，按提示词源对比
    lib/local-gateway.ts   # smoke / eval 共用的本地端点装配
apps/web/src/
  App.tsx                  # 应用外壳：URL 导航（会话 / 设置） + WorkspaceLayout
  main.tsx                 # 入口：主题、i18n 接线与 client 的 Provider
  components/brand-head.tsx # 文档级品牌元素（favicon）
  lib/i18n.ts              # 应用 i18n 单例（接线在 @ucode/ui/lib/app-i18n）
  lib/sdk.ts               # 创建 client 实例
  index.css                # tailwind 入口：import @ucode/ui/theme.css + @source 包源码
apps/desktop/
  src/main/index.ts        # Electron 主进程：窗口、服务凭证注入（webRequest）、连接 IPC
  src/main/connection.ts   # 读 $APP_HOME/app/service.json → { baseUrl, token }
  src/main/proxy.ts        # `app://desktop` 协议：页面与 `/api/*` 同源，转发时注入令牌
  src/preload/index.ts     # 把「服务是否已注册」暴露给渲染层（凭证不经预载）
  src/renderer/            # 渲染层外壳：入口、i18n 接线、client 装配、窗口内导航
  vite.config.ts           # 渲染层（端口 5174）
  scripts/build-main.mjs   # esbuild 打 main（ESM）/ preload（CJS）
```

### 实现要点

- **会话持久化**：消息正文交给 pi 的 `SessionManager`，落在 `$APP_HOME/harness/sessions/*.jsonl`；应用自己的会话元数据与列表索引（覆盖值、名称、预览、计数、时间、文件路径）放 `$APP_HOME/app/app.db`。
- **索引同步**：启动时 `reconcile()` 以 JSONL 为准对齐索引（补齐外部新增、清理已删文件），每轮生成落定后再回写一次；列表 / 详情直接读 SQLite，不再扫描 JSONL 目录。
- **AgentSession 池**：同一会话串行执行（流式期间到达的消息会排队），空闲 `APP_POOL_IDLE_MS` 后 `dispose()`，下次访问从 JSONL 恢复。
- **配置热重载**：`config/update` 先合并并落盘，再按需重建 `ModelRuntime`（只有联网搜索变化时不重建）；
  内存会话随之重装——空闲的立即回收、正在生成的本轮跑完再回收，都不会打断当前这一轮。
  重建失败（如 provider 落不了地）时磁盘、运行时与会话都保持原状。
- **模型注入不落盘**：provider 目录与 apiKey 通过 pi 的 `registerProvider` / `setRuntimeApiKey` 注入内存，不生成 `harness/models.json`；`config.json` 是模型配置的唯一事实源。
- **工具集在装配层收口**：工具声明由模式给（`build` / `plan` / `ask` 都走 pi 的 `defaultTools`，`plan` 多一个
  `present_plan`），自研工具走 `customTools`；`grep` / `find` / `ls` 直接用 pi 内置实现，不自己写。
  只读模式靠权限规则断掉写盘 / 执行，不从声明里拿掉（见 [`docs/modes-and-permissions.md`](./docs/modes-and-permissions.md)）。
  **本服务只启用这份固定工具集**：pi 扩展（`$APP_HOME/harness/extensions`、项目 `.pi/extensions`）或 pi 包
  注册的工具不在清单里，不会生效。
- **外部内容不入信任链**：`webfetch` 只抓公网地址（回环 / 私网 / 链路本地一律拒绝，重定向逐跳校验），
  并用 `<fetched>` / `<search_results>` 边界包裹返回内容，正文里的同名标签先中和（否则页面能「闭合」边界），
  工具说明里声明「那是数据不是指令」。
- **未落盘的草稿会话**：pi 只在产生 assistant 回复后才写文件，所以新建会话的名字/模型先落在 SQLite 的草稿行（`persisted = 0`），首次回复后索引对齐。
- **schema 演进**：`db/index.ts` 用 `PRAGMA user_version` 记录版本，新增迁移时递增 `SCHEMA_VERSION` 并补一条 DDL；开发初期允许破坏性变更，删本地 `app.db` 重建即可。
- **删除会话**：先停用运行中的资源（`pool.dispose` / `events.remove`），再删 SQLite 行，最后删 JSONL 文件；顺序不能颠倒，见 `docs/database.md`。
- **主题与外观**：`next-themes` + `.dark` class 管深浅三态；字号基准、界面密度、界面字体、代码字体与配色主题由设置写入 `<html>` 的行内变量（`localStorage` 持久化，键由品牌派生），首屏由 `index.html` 的内联脚本预先应用以避免闪动。颜色、圆角、字号与尺寸全部走语义 token（`DESIGN.md`），`scripts/verify` 会拦下裸色值与越界档位。

## 验证

```bash
pnpm check     # biome check . && pnpm -r typecheck && pnpm -r test && pnpm verify
pnpm test      # 各包单元测试（Node 内置 node:test，`src/**/__tests__/**/*.test.ts`）
pnpm verify    # 只跑约定校验（scripts/verify）
```

约定校验覆盖八项：SQLite 迁移版本必须从 1 起连续、契约字段必须 camelCase 且 `*Request` 有配对的 `*Input`、
业务组件不得出现裸色值或非语义颜色 utility 且语义层只能引用调色板与 `color-mix`、设计档位（字号 / 图标 / 圆角 / 阴影 /
层级 / 时长 / 透明度）必须落在白名单内、配色主题必须覆盖全部主题层变量且与清单一致、i18n 目录范围与冗余合规且
禁止硬编码中文、源码禁止硬编码品牌名、有测试用例的包必须声明 `test` 脚本。对应规范见 `docs/`、`AGENTS.md` 与 `DESIGN.md`。

## 冒烟测试

不走 HTTP，直接用 pi SDK 验证「端点 + 模型 + 工具 + 流式」：

```bash
pnpm smoke
# 或指定参数
pnpm -F @ucode/server smoke -- --base-url http://localhost:8317/v1 --api-key devtest --model glm-5.2
```

## 提示词评测

系统提示词有两套可切换的源（`APP_PROMPT_SOURCE`）：`custom` 自研（默认，正文以 opencode 的
提示词分节与规则为蓝本移植改写）与 `pi` 基线（pi 默认提示词 + 自研片段）。正文按语言存放在
`prompt/locales`（当前仅 `zh-CN`），按模型族在 `prompt/variant.ts` 解析变体（当前统一 `default`）。
哪套更好由评测决定，不看文案观感——`eval` 用真实模型跑一组固定用例，抓工具调用与最终回复做断言，
支持按源对比：

```bash
pnpm eval                                   # 跑默认源
pnpm eval -- --source custom,pi             # 两套源对比
pnpm eval -- --model deepseek-v4-flash,glm-5 --attempts 3   # 多模型 + 每例重复 3 遍看通过率
pnpm eval -- --case read-not-cat            # 只跑指定用例
pnpm -F @ucode/server eval -- --base-url http://localhost:8317/v1 --api-key devtest
```

用例在 `server/scripts/eval.ts` 里集中声明（模式 + 提示词 + 工具 / 回复 / 落盘断言），
需要真实端点，因此不进 `pnpm check`；会写盘的用例在隔离工作区（`.tmp/eval/workspace`）里跑，不碰仓库。
用例断言的是模型行为，存在随机性：用 `--attempts` 看通过率、`--model` 多个模型横向比；
依赖模型自觉行为（如 plan 模式主动调 `present_plan`）的用例标为**可选**（输出里带 `*`），
只报通过率、不计入退出码。

## 常见问题

- **`configured: false`**：还没配 provider，或 `defaultModel` 指向了不存在的 `provider/model`；看 `health` 返回的 `error`。
- **模型列表为空**：`models/list` 只列出配置里有凭证的 provider，检查 `baseUrl` / `apiKey`。
- **`sessionId` 报 400**：id 只接受 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（与 pi 的会话 id 规则一致），新建会话用返回的 UUID。
- **调用上游报 400 `invalid_request`**：多为网关兼容性差异。先用 `config/test` 二分定位，必要时通过模型的 `compat` 关掉 `supportsDeveloperRole`、`supportsStore`、`supportsReasoningEffort` 等开关。
- **端口被占用**：改 `.env`（开发）或 `.env.prod`（生产）的 `APP_PORT`；web 开发代理会自动读取同一值。
- **⚠️ 安全**：`/api/v1` 已全量鉴权（会话 token / `serviceToken` / 一次性配对，统一走 `Authorization: Bearer`），服务默认只监听回环地址，
  `APP_HOST=0.0.0.0` 需显式开启。但通过鉴权等同本机 owner，背后的 agent 有 `bash` 权限 ——
  **不要把服务暴露到公网或不可信网络**。约定见 [`docs/api.md`](./docs/api.md)「鉴权」。
