# ucode 服务化与鉴权方案

> 状态：**方案（未实现）**。本文只描述设计与改动点，不含实现代码。
> 目标形态：桌面端与 TUI 整包安装（服务层内含），同一用户共用一个服务实例；
> 后装客户端只做「发现 + 连接」，不再安装服务端。服务层本质是一个 web 服务，
> 因此鉴权复用标准 web 鉴权模型。

## 0. 目标与范围

> 本方案取代 `TODO.md` 的「P0 · 给 `/api/v1` 加鉴权，并默认只监听回环地址」条目；该条目已收敛为状态与链接。

**做**

- 服务注册与发现、服务生命周期、版本协商、多客户端。
- 鉴权：超管密码、会话、一次性配对链接、本机原生客户端凭证。
- 打包形态：客户端整包内含服务运行时；服务与 Web UI 解耦。

**不做**

- Location / Project / Worktree 作用域模型。
- 插件运行时、Console 类云能力。
- 角色 / 权限分级（暂缓，仅留口子，见 §3.8）。
- 中继服务（独立立项，见 [`relay.md`](./relay.md)）。

## 1. 必须守住的不变量

- `@ucode/contracts` 单一事实源，响应生产点显式标注契约类型（契约改字段要编译失败）。
- 事件流 `seq` + 快照接续：生成所有权在服务端、与连接解耦。它是多客户端与断线重连的基础，不得在服务化中退化。
- 会话正文 JSONL / 元数据 SQLite 的持久化分层不变。
- `$APP_HOME` 仍是服务的数据目录；客户端本地偏好（主题 / 语言 / 窗口 / 导航）不落服务端。

## 2. 服务注册与生命周期

### 2.1 注册文件

`$APP_HOME/app/service.json`，权限 `0600`，**由服务独占写入**，客户端只读：

```jsonc
{
  "host": "127.0.0.1",              // 127.0.0.1 = 仅本机；0.0.0.0 = 允许局域网
  "port": 2048,                      // 0 表示自选可用端口，启动后写回真实端口
  "serviceToken": "…",               // 本机原生客户端的免交互凭证
  "password": "…",                   // 超管密码，明文；首次启动自动生成
  "createdAt": "…",
  "relay": { "enabled": false, "url": null, "deviceId": null, "deviceToken": null }
}
```

约定：

- `serviceToken`、`password` 都是明文。二者都等价于 owner 级凭证；同一文件里已含 `serviceToken`，密码明文不额外降低安全等级，且换来「忘记可回显」。文件权限 `0600` 是整份文件的信任根。
- `password` 首次启动自动生成，并在启动日志与首次运行界面各展示一次；「改密码」= 改该字段 + 撤销全部会话。
- 登录校验用常量时间比较；不再需要 scrypt 存储哈希，但**登录接口限流必须保留**（威胁是网络攻击者）。
- **边界**：`service.json` 只放服务级连接与凭证（host / port / 凭证 / relay）；模型 / websearch / 记忆仍归 `config.json`（`env.configPath`），它仍是模型配置的唯一事实源。

### 2.2 `ensure` 语义

客户端启动流程：

1. 读 `service.json`；
2. `GET /api/v1/health` 探活，并用 `/api/v1/info` 校验版本兼容范围；
3. 健康且兼容 → 直接连；否则尝试拉起服务；
4. 拉起用注册文件的**独占锁 + pid 仲裁**，避免多客户端并发拉起多个实例；已有实例正在启动时等待它。

这是「后装客户端不必再装服务端」的机制来源。

### 2.3 生命周期

`ucode service start|stop|status|restart`（或等价入口）。服务独立于客户端：**谁先装谁落地，卸载客户端不删服务**。

## 3. 鉴权

### 3.1 设计原则

1. **复用 web 鉴权**：密码 + 会话 Cookie、Bearer Token、一次性配对码、Origin/Host 校验、CSRF、限流，全部用标准 web 套路。
2. **不做 IP 信任**：loopback 不自动放行。理由：DNS rebinding——任意网页都能让浏览器去请求 `127.0.0.1:端口`，按 IP 放行会让该网页驱动本机 agent 执行 `bash`。本机原生客户端改用 `serviceToken` 免交互，本机浏览器走配对链接或登录。
3. **单一鉴权管线**：Cookie / Bearer /（未来）中继断言统一解析为同一「主体（principal）」。
4. **鉴权是外层门，权限引擎是内层门**：通过鉴权不等于免审批，两者叠加。

### 3.2 主体与凭证模型

| 凭证 | 谁用 | 形态 | 存储 |
| --- | --- | --- | --- |
| `serviceToken` | 本机原生客户端（TUI / CLI / 桌面壳） | 静态 Bearer，≥128bit 随机 | `service.json`（0600） |
| `password` | 人（登录页 / CLI 登录） | 明文，首次启动自动生成 | `service.json`（0600） |
| 会话 session | 浏览器（本机 / 局域网 / 远程） | 不透明 id 的 httpOnly Cookie | SQLite `auth_session`（可撤销） |
| 配对码 pairing | 一次性的局域网 / 远程接入 | 短 TTL、单次使用的高熵码 | 内存（服务重启即失效） |

### 3.3 三种接入路径

**a) 本机原生客户端（免交互）**

原生进程与服务器同属一个 OS 用户，能读只有该用户可读的 `service.json`，因此「读得到文件」即身份证明。客户端把 `serviceToken` 注入 `Authorization` 头，服务端认头。

- TUI / CLI：客户端从 `service.json` 读到端点与 `serviceToken`，注入 `Authorization` 头（ucode 侧新增一个 `resolveEndpoint()` 供原生客户端复用）。
- **桌面端**：作为原生壳读取 `serviceToken` 并**注入自己的 webview**，因此桌面端也能免登录。这是桌面的能力，不是服务器的。

**b) 局域网 / 远程 · 一次性配对链接**

- 已登录的应用端打开「远程访问」弹窗 → `POST /api/v1/auth/pairing/create` → 返回 `{ url, code, expiresAt }`，形如 `http://<lan-ip>:<port>/auth/connect/<code>`，展示二维码。
- 对方打开链接 → `GET /auth/connect/:code` 校验（存在 / 未过期 / 未使用）→ 标记已用 → 签发会话 Cookie → 302 进应用。
- 约束：TTL 5 分钟、单次使用、高熵、常量时间比较、兑换即作废、`Referrer-Policy: no-referrer`。

**c) 局域网 / 远程 · 登录页**

直接打开 `http://<host>:<port>/` → 未认证 → 跳 `/login` → 输入 `password` → 签发会话 Cookie。与普通 web 登录一致。

> 三种路径最终都收敛为「有 session 或 bearer」；中继路径由本地中继客户端携带 `serviceToken` 转发，同样落在这一模型上（见 [`relay.md`](./relay.md)），无需新增鉴权机制。

### 3.4 会话与撤销

- 落 SQLite `auth_session`：id 哈希、createdAt、expiresAt、lastSeenAt、revokedAt、label。
- 默认 30 天；改密码 → 撤销全部会话；「远程访问」弹窗可列出并逐个撤销活动会话。
- CSRF：`SameSite=Strict` + `Origin` 校验 + 仅 POST + JSON。有 TLS 时加 `Secure`；局域网明文 http 下不能加（见 §3.6）。

### 3.5 中间件与放行清单

位置：`requestLogger` 之后、全部业务路由之前。

**放行**：`GET /api/v1/health`（**只返回 `{ up, version }`，不含模型 / 配置**）、`GET /api/v1/info`（发现与兼容：`{ version, apiVersion, compatRange }`）、`POST /api/v1/auth/login`、`GET /auth/connect/:code`、登录页静态资源、`OPTIONS` 预检。
**其余一律认证**：未认证返回 `401 unauthorized`；浏览器导航类请求 302 到 `/login`。原富载荷的 health 拆成认证接口 `GET /api/v1/status`。

解析顺序：`Authorization: Bearer <serviceToken>` → 会话 Cookie；任一命中即通过。

### 3.6 安全清单

| 风险 | 处理 |
| --- | --- |
| DNS rebinding / 本机恶意网页 | 不做 IP 信任，统一鉴权 + 校验 `Host` / `Origin` |
| CSRF | `SameSite=Strict` + `Origin` 校验 + 仅 POST + JSON content-type |
| 密码爆破 | 登录限流 + 失败退避 + 常量时间比较 |
| 配对码泄露 / 重放 | 5 分钟 TTL + 单次 + 高熵 + 常量时间 + 兑换即废 + `no-referrer` |
| token 出现在 URL | 一次性码兑换后立即换 Cookie，不长期驻留 URL |
| 局域网明文 http | 默认 `127.0.0.1`；开 `0.0.0.0` 需显式操作并告警。明文下 Cookie 不设 `Secure`，配对码短 TTL 缓解嗅探；更强则自签 TLS 或走中继 |
| **授权过度** | 通过远程鉴权 = 拿到本机 `bash`。「远程访问」弹窗必须显式提示；后续可给远程主体设置权限上限 |

### 3.7 契约、路由、SDK、前端

- **契约**：新增 `auth` 域——`authLoginInputSchema`、`AuthSessionView`、`PairingCreateOutput`、`WhoamiResponse`；错误码 `unauthorized` / `invalid_credentials` / `pairing_invalid` / `pairing_expired` / `rate_limited` / `forbidden`。
- **路由**（除 connect 外均带 `/api/v1` 前缀）：`POST /api/v1/auth/login`、`POST /api/v1/auth/logout`、`GET /api/v1/auth/session`（whoami）、`POST /api/v1/auth/pairing/create`、`POST /api/v1/auth/password`；前缀外：`GET /auth/connect/:code`（302 + Set-Cookie）。
- **SDK**：传输层支持 bearer 与会话 Cookie、401 处理；`createClient` 增加 `auth` store。
- **前端**：`/login` 登录页；设置里「远程访问」弹窗（LAN 开关 / 生成配对链接 + 二维码 + 倒计时 / 活动会话列表与撤销 / 改密码）。

### 3.8 角色与权限分级：暂缓

暂不做，但留极小的口子，避免以后加角色要改中间件：中间件解析出的 principal 带 `scopes` 字段，现在恒为 `["*"]`；未来只改「哪里写 scopes」与「哪里读 scopes」。同时记住：**远程主体 = owner = 本机 `bash`**，UI 必须显式提示。

## 4. 版本协商与多客户端

- `/api/v1/info` 返回 `{ version, apiVersion, compatRange }`，字段口径：
  - `version`：服务端版本，取根 `package.json` 的 `version`（启动时读一次）。
  - `apiVersion`：接口契约版本，沿用现有 `API_VERSION`（`packages/contracts`）。
  - `compatRange`：本服务可被哪些**客户端版本**使用，semver range 字符串（如 `^0.2.0`）。判定用最小实现：只比主次版本，不引入 semver 依赖；`apiVersion` 不一致直接判为不兼容。
- 客户端据此决定「用现有服务 / 自己拉起 / 提示升级」。
- 客户端导航状态（当前选中会话等）留在客户端（沿用 URL 方案），服务端只持有会话本身。
- 多客户端交互归属：权限审批 / `question` 广播到会话事件流，**任一客户端可答、首个响应生效**（沿用 `InteractionBroker` 结算方式），需写入文档。

## 5. 打包形态

- 服务运行时作为独立安装位（客户端依赖、不独占）：桌面端整包含它，TUI 只带客户端。
- 服务与 Web UI 解耦：静态托管（`serveStatic`）变成可选能力。

## 6. 分阶段落地顺序

1. 服务注册 + host/port + `serviceToken` + 回环默认监听。
2. 鉴权中间件 + 登录页 + 会话 + `password` + `serviceToken`。
3. 配对链接 + 「远程访问」弹窗 + LAN 开关（`0.0.0.0` 显式开启）。
4. 版本协商 + 多客户端 + 服务 / Web 解耦。
5. 打包形态。
6. 中继 + 移动端（独立立项，见 [`relay.md`](./relay.md)）。

前 3 步同时是「用 ucode 开发 ucode」的门票：服务可重启、客户端不掉线。

文件级改动与验证见附录 A。

## 7. 待决策

- 局域网明文 http 是否接受，还是要求自签 TLS / 仅走中继。
- 密码重置策略（本地文件系统即凭证 vs 提供 CLI 重置）。
- 远程主体是否设权限上限（角色体系暂缓）。
- 中继相关待定见 [`relay.md`](./relay.md)。

## 8. 与自迭代的关系

服务与客户端分离后，改服务端代码后重启服务不会杀掉 TUI / 桌面客户端，客户端重连即可，补上了「用 ucode 开发 ucode」时「改坏了自己起不来 / 重启断线」的结构性短板。

## 附录 A. 落地细化（模块 / 接口 / 分阶段文件与验证）

### A.1 服务端模块

新增（遵循 `lib/` / `routes/` 一级用文件夹的约定）：

| 路径 | 职责 |
| --- | --- |
| `server/src/lib/service-file/index.ts` | 定位 / 加锁 / 读写 `$APP_HOME/app/service.json`（0600）；随机生成 `serviceToken` / `password`；`ensure` 所需的 pid 仲裁 |
| `server/src/lib/auth/credentials.ts` | `serviceToken` / `password` 的读取与常量时间比较 |
| `server/src/lib/auth/sessions.ts` | 会话签发 / 校验 / 撤销 / 列举（哈希落库） |
| `server/src/lib/auth/pairing.ts` | 配对码内存表：签发 / 兑换 / 过期 |
| `server/src/lib/auth/middleware.ts` | Hono 鉴权中间件：放行清单 + 解析 principal |
| `server/src/db/auth-session-repository.ts` | `auth_session` 表的增删查 |
| `server/src/routes/auth/index.ts` | 登录 / 登出 / whoami / 改密码 / 签发配对码 |

改动：

| 路径 | 改动 |
| --- | --- |
| `server/src/index.ts` | `serve` 指定 `hostname`；端口 0 时回写；挂载鉴权中间件；静态托管改为可选；`GET /auth/connect/:code` 挂在 API 之外 |
| `server/src/env.ts` | host / port 来源优先级：env > `service.json` > 默认 |
| `server/src/db/index.ts` | schema v7：`auth_session` 表 |
| `server/src/routes/health/index.ts` | 拆为 health(min) / info(discovery) / status(authed) |
| `server/src/app.ts` | 装配 `auth-session-repository` 与会话服务 |

### A.2 接口与契约

| 接口 | 认证 | 用途 |
| --- | --- | --- |
| `GET /api/v1/health` | 否 | 存活：仅 `{ up, version }` |
| `GET /api/v1/info` | 否 | 发现与兼容：`{ version, apiVersion, compatRange }` |
| `GET /api/v1/status` | 是 | 现有运行时状态（configured / defaultModel / thinkingLevel / workspace…），替代原 `HealthResponse` 的富载荷 |
| `POST /api/v1/auth/login` | 否 | 密码登录 → 会话 Cookie |
| `POST /api/v1/auth/logout` | 是 | 注销当前会话 |
| `GET /api/v1/auth/session` | 是 | whoami + 会话信息 |
| `POST /api/v1/auth/password` | 是 | 改密码 → 撤销全部会话 |
| `POST /api/v1/auth/pairing/create` | 是 | 签发一次性配对链接 |
| `GET /auth/connect/:code` | 否（一次性码即凭证） | 兑换配对码 → 会话 Cookie → 302 |

契约：`packages/contracts/src/auth/{input,output}.ts`；`envelope.ts` 新增错误码 `unauthorized` / `invalid_credentials` / `pairing_invalid` / `pairing_expired` / `rate_limited` / `forbidden`；`health/output.ts` 按 health / info / status 拆分——原 `HealthResponse` 更名为 `StatusResponse`（认证接口），新增 `HealthMinimalResponse`（`{ up, version }`）与 `ServerInfoResponse`（`{ version, apiVersion, compatRange }`）。字段口径见 §4。

### A.3 鉴权流程（中间件）

```
请求
 ├─ 放行清单命中？ ─是→ 继续（health / info / login / connect / 静态资源 / OPTIONS）
 ├─ Authorization: Bearer == serviceToken？ ─是→ principal(owner, scopes=["*"])   // 常量时间
 ├─ Cookie 会话有效？ ─是→ principal(owner, scopes=["*"])
 └─ 否 → 401；浏览器导航类 → 302 /login
```

- CORS：由 `origin: "*"` 改为**白名单 + `credentials: true`**；同源与原生客户端不需要 CORS，中继转发不经 CORS。
- Cookie 名由品牌 slug 派生（`<slug>_session`）；`HttpOnly` + `SameSite=Strict` + `Path=/`；有 TLS 时加 `Secure`。

### A.4 分阶段文件级改动与验证

**阶段 1 · 服务注册与监听**
- 改动：`lib/service-file/*`、`env.ts`、`index.ts`（hostname / 端口回写 / 静态托管可选）。
- 验证：`APP_PORT=0` 启动 → `service.json` 写入真实端口且 `0600`；二次启动复用同一文件；`pnpm check`。

**阶段 2 · 鉴权**
- 改动：`db/index.ts`(v7)、`db/auth-session-repository.ts`、`lib/auth/*`、`routes/auth/*`、`index.ts` 挂载与 health / info / status 拆分、contracts `auth` 域 + 错误码、`sdk`（bearer / cookie / 401）、`ui` / `web` 登录页、i18n。
- 验证：未认证 → `401`（导航 302 `/login`）；`GET /api/v1/health` 仅 `{ up, version }`；带 `serviceToken` 的 Bearer 通过；密码登录种 Cookie 后可调业务接口；改密码后旧会话失效；`pnpm check` + agent-browser 走查。

**阶段 3 · 配对与远程访问**
- 改动：`lib/auth/pairing.ts`、`routes/auth`（签发）、`index.ts`（`/auth/connect/:code`）、contracts `PairingCreateOutput`、UI「远程访问」弹窗（LAN 开关 / 链接 + 二维码 + 倒计时 / 会话列表与撤销 / 改密码）。
- 验证：链接 5 分钟内可用、**仅一次**、过期即失效、兑换后 302 且带 Cookie；开 `0.0.0.0` 后局域网可达、默认 `127.0.0.1` 不可达。

**阶段 4 · 版本协商与多客户端**
- 改动：`index.ts` 挂 `/api/v1/info`；`sdk` 的服务发现与 `ensure`（发现 → 拉起 → 等待）；`ui` 401 统一跳登录。
- 验证：两个客户端连同一服务；服务重启客户端重连不丢会话；版本不匹配给出可读提示。

**阶段 5 · 打包**（仓库外，另立项）
- 桌面端内置服务运行时；TUI 仅客户端；服务与 Web UI 解耦已在前四阶段完成。

**阶段 6 · 中继**（独立立项，见 [`relay.md`](./relay.md)）

### A.5 验收清单

- [ ] `service.json` 生成 / 复用 / `0600`，端口自选可回写。
- [ ] 默认仅回环；`0.0.0.0` 需显式开启且给出告警。
- [ ] 三种接入路径都能建立会话；配对码单次、限时。
- [ ] `serviceToken` 让本机原生客户端免交互；桌面 webview 注入后免登录。
- [ ] `/api/v1/health` 不泄露模型 / 配置；未认证不能触碰业务接口。
- [ ] 改密码撤销全部会话；活动会话可列举、可撤销。
- [ ] CORS 收紧为白名单 + credentials。
- [ ] 多客户端共享服务、服务重启不丢客户端会话。
- [ ] `pnpm check` 通过；`docs/api.md` 与契约一致（接口参考由 `pnpm api:docs` 更新）。
