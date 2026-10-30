# UCode 中继（hub）（方案）

> 状态：**落地中（2026-10-17）**，阶段 0 已落地（来源头进日志、`brand.deployment.hubUrl`、SSE 转发约定）。
> 本文取代并归档原先的 `plans/relay.md`；前置的服务化与鉴权已落地（见 [`service-and-auth.md`](./service-and-auth.md)）。

中继是一个**切面**——对外提供一组「登录后才可用」的能力（先落地的是模型 API 端点，后续再加别的 API 端点），
登录这一个动作同时完成三件事：认证、把 UCode 与中继绑定、建立通道。之后 app 顺着通道调用 UCode 服务层。
中继不经手 UCode 的鉴权，只多一个来源标记。

本质是「反向隧道代理」：UCode 处在 NAT 后无法接受入站，由 UCode 主动向中继建立出站长连接，
中继把公网请求回灌。不需要 STUN / UPnP / 打洞。

## 形态

```
app/移动端 ──只登 hub──▶ [hub 服务] ══隧道══▶ [UCode 中继客户端]
                          │ ingress 按设备路由          │ 本地 serviceToken + x-hub-* 来源头
                          ▼                            ▼
                    <device>.<baseDomain>         UCode 服务层（同一套 /api/v1 + 事件流）
```

## 本轮决策（2026-10-17）

| 项 | 决定 |
| --- | --- |
| 部署形态 | 每企业一套自建；不做多租户 / 计费 / 租户隔离 |
| 账号 | 沿用基座语义：**部署后首个 init 的人成为唯一超管**（`is_root` 部分唯一索引兜底），其余运营账号由超管在后台建 |
| 代码落位 | `hub/`（与 `server/` 同级）以 **git submodule** 挂在本仓（独立仓库 `ucode-hub`，自带 workspace、锁文件与工具链） |
| 实现来源 | 从 `easyx-dev/fsdx`（main）裁切：TanStack Start + Nitro + SQLite（`node:sqlite`）+ Drizzle + antd 双端 |
| 裁切保留 | 双端用户体系与角色权限、`dict`、`track`（埋点与后台分析）、i18n、审计、文件存储、系统配置加密、定时任务、指标、系统监控 |
| 进程形态 | **单进程**：admin、隧道 WS、ingress 同端口；先做四项验证，不过则把管道拆成独立进程（回退预案已定） |
| 数据面 | 透明字节转发：UCode 侧补本地 `serviceToken`，**鉴权管线不改**；来源头只进日志与统计 |
| 唯一门 | hub 的入口鉴权是唯一门（app 持 hub 会话、校验设备归属）；经 hub 到 UCode 即 owner（可跑 `bash`） |
| 协议边界 | v1 不支持 `Upgrade`（终端、内置浏览器面板不经 hub），返回明确错误码 |
| 工具链 | hub 与 ucode 统一：同一份 `biome` 配置、依赖版本走根 `catalog:`（含 `typescript ^7.0.2`） |
| 部署目录 | `hub/deploy/` 是仓内普通目录，**不使用 submodule**；容器名 / 镜像名 / 路径全部按 hub 重写 |
| 客户端前台 | 保留前台 SSR 线，新增「我的设备」页：自己的设备信息 + 已连接的 UCode 列表 |
| 后续 | 用量统计（前台按用户、后台按运营）、模型端点、内置资产云同步 |

## 关键性质

- **app 只登 hub**：UCode 不接触 app 的登录，不需要断言 / 角色 / scope。
- **中继进来的调用与本地 app 层调用完全一致**：同一套接口、同一套鉴权，仅多一个来源头。
- **硬约束**：通道必须能承载 SSE（事件流为长连接流式），中继侧不得缓冲、不得给长连接设请求超时；
  公网路由用子域以隔离 origin（Cookie / 会话）。
- **降级**：中继不可达时本地仍能用本地 provider 正常干活，中继不是单点。

## 信任推论（必记）

「app 只登中继」+「中继进来的请求等同本地调用 = owner 身份」相加 ⇒ **任何经中继到达 UCode 的请求都是全权身份（可跑 `bash`）**。安全责任完全落在中继入口：中继必须只放行你自己的 app / 账号。角色体系暂缓可以，但将来做多人共享时这条是前提。

## 安全加固（本轮已做）

中继是「防机器被拿下」的最上游：它被攻破等于全部设备被攻破。本轮做了以下可验证的收紧：

- **数据库换 SQLite**：库文件落应用数据卷、权限 0600，公网不再有数据库端口（原先 PostgreSQL 默认绑全网，是本轮审计里最危险的一条）。
- **会话令牌可撤销**：JWT 载荷带令牌版本 `v`，与用户表 `token_version` 比对；改密 / 被重置 / 登出即自增，Cookie 会话、`/api/v1/*` 与 `/v1/*` 三条路径都校验；有效期 7 天 → 24 小时。
- **登录失败节流**：按账号累计（5 次 → 30 秒、10 次 → 5 分钟、20 次 → 1 小时），成功清零；用户名不存在也跑一次口令比对，消除枚举侧信道；口令 cost 统一 12。
- **邮箱验证码**：CSPRNG 生成、同码错误 5 次即作废、发新码作废旧码；未确认邮箱不能用作恢复通道，「忘记密码」失败文案统一。
- **超管保护**：非 root 只能重置自己；角色分配与角色权限写入不得超出自己已有权限（`**` 只有 root 能授）。
- **自助注册默认关闭**（`client_register_enabled`），注册页与入口随开关。
- **入口限速与安全头**：`deploy/nginx.conf.example` 给出四档 `limit_req`、HSTS / `X-Frame-Options` / `nosniff` / `Referrer-Policy`、TLS 1.2+，并把「控制面来源收敛」写成建议（`/health` 与 `/api/metrics` 本身不鉴权）。
- **移除 `custom_head_config`**：它等于「配置编辑权 = 可执行公共站点任意脚本」。

**本轮明确不做**（记录在案）：设备面独立 origin（同源合租）、`/file/r/$id` 的公开读取、管理端富文本渲染面、`config:edit` 其余能力、内置资产清单签名（仍未决，是「中继被攻破 → 全网下发」这条链上唯一未断的点）。

## 口子（已落地状态）

1. **鉴权与 ingress 无关**：配对码 / 登录只假设「浏览器能到达服务」，不假设本机还是 LAN。（已成立）
2. **来源头进日志**：`requestLogger` 记录 `x-hub-source` / `x-hub-device` / `x-hub-client`，供统计；
   不参与鉴权。（已落地，头名见 `server/src/constants/hub.ts`）
3. **中继地址并入 B 端定制入口**：`@ucode/brand` 扩为「品牌 + 部署」，加 `deployment.hubUrl`（默认 `null`）；
   本机设置页可覆盖并存 `service.json` 的 `relay.url`。（品牌侧已落地，设置页随阶段 5）
4. **配置预置可覆盖 provider**：本地 `config.json` 仍是模型配置唯一事实源，中继登录只是**可选注入**一个 provider。（已成立）
5. **通道承载 SSE 的约束**写进契约与文档。（已落地，见 `docs/api.md`「传输约定」与「事件流」）

## 内置资产云同步（接口约定，待实现）

插件平台的「内置资产」（内置技能、提示词、内置插件）要能从云端下发更新，而不是只能等产品发版。
中继侧按下面的约定暴露接口，UCode 侧的口子挂在
`harness/plugins/builtin/index.ts` 的 `resolveBuiltinAssets()` 上（恒返回随包集合，云端替换未接；
状态记 `app/builtin/manifest.json`）。

**方向**：UCode 作为客户端**主动出站拉取**（与隧道相反，不需要中继发起连接），因此中继不可达只是
「拿不到更新」，不影响服务启动与装配。

```
GET /builtin/manifest                  # 清单：id / kind / version / sha256 / 下载地址
GET /builtin/assets/<id>/<version>     # 内容（二进制或 JSON），逐文件 sha256
```

- **鉴权**：用设备身份（`deviceToken`），复用登录后的设备绑定，不新造凭证。
- **比对**：本地 `manifest.json` 与远端清单按 `id` + `version` 比对，缺失或版本不同才下载。
- **校验**：逐文件 sha256；只接受配置里的中继域，不跟随清单给出的任意外链。
- **生效边界**：纯文本与声明式内容（技能正文、提示词、模式声明、界面贡献）可直接生效；
  **可执行内容（hooks / bin / MCP / TS 扩展 / 插件工具）必须签名 + 显式信任**，与第三方插件走同一套
  逐插件信任，不因来源是运营方就放宽。
- **推送**：云端要主动通知时走中继既有的事件通道，UCode 收到后按同一套比对 / 下载 / 物化流程处理。
- **状态**：UCode 侧记 `origin`（`packaged` / `cloud`）与 `fetchedAt`，设置页后续可展示来源与版本。

## 落地阶段

| 阶段 | 内容 |
| --- | --- |
| 0 · 口子 | 来源头、`brand.deployment.hubUrl`、`docs/api.md` 约定（**已完成**） |
| 1 · 裁切 | 以 fsdx main 为基线建 `hub/`，删示例与残留、统一工具链、四处必改、`UPSTREAM.md`、并入 workspace 与 CI（**已完成**；后于 2026-10-26 独立成单独仓库，以 submodule 挂载到本仓） |
| 2 · 验证 | 大 body 流式、SSE 首帧延迟、WS + ingress + admin 同端口共存、断开可观测；**4/4 通过**，结论与判定标准见 `hub/docs/spike.md`，脚手架留在 `hub/app/server/**` 与 `hub/app/scripts/spike/`；管道走 Nitro server route，回退预案不再需要（**已完成**） |
| 3 · 设备域 | `device` 表与迁移、服务层、后台 CRUD + 登记与轮换令牌、吊销、前台「我的设备」、在线态巡检任务、登录与 ingress 限流、审计；示例业务 `news` / `demo` 已连同表一起删除（含删表迁移）（**已完成**，端到端已验：登录 / 登记 / 轮换 / 列表 / 吊销 / 审计 / 页面可达） |
| 4 · 隧道与 ingress | 协议包 `@ucode/hub-protocol`（帧 / 多路复用 / 背压 / 限额）、hub 隧道宿主与 ingress、UCode 侧中继客户端；**六项端到端已验**（经隧道调 UCode 状态与事件流、未认证 401、设备离线 502、重启后自愈、30MB 经隧道上传 200），见 `hub/docs/tunnel.md`（**已完成**） |
| 5 · UCode 侧 | 中继客户端服务层 + `/api/v1/hub/{status,login,logout}` 路由与契约 + SDK `hub` store + 设置页「中继」一节 + i18n / 错误码映射 + `docs/hub.md`；**端到端已验**（未鉴权 401、登录后 `configured/deviceId` 就位、隧道 `connected:true`、经隧道访问 200、登出后 502、地址不可达给 `hub_unreachable`）（**已完成**） |
| 6 · 后置 | 中继模型端点 + 用量统计（后台按运营、**前台「我的用量」按用户**）+ 内置资产云同步；**端到端已验**：假上游转发 200 / 流式逐帧带 usage / 用量落库 / 未鉴权 401 / 限流第 61 次起 429（换设备额度独立）/ `/admin/usage` 与 `/usage` 页可达 / 发布→清单→拉取→物化→二次拉取 skipped / 一键注入的 relay provider 被运行时认作默认模型且凭据可用（**已完成**） |
| 7 · 交付 | `deploy/` 内联 + `nginx.conf.example`（TLS / WS 升级 / 事件流不缓冲 / 泛子域 ingress）+ 逐企业部署说明（含「先 init 再开域名」）（**已完成**） |
| 8 · 隧道 WebSocket | 协议 v2：`request.upgrade` + `close` 帧 + 数据帧文本变体；hub 侧路径寻址的 WS 终结、UCode 侧桥接本机 WebSocket（工作台终端、内置浏览器面板）。两端单测与「升级请求被判给专用 route、普通 GET 仍回灌」已实测，真机走查待验证 |

## 待定

- 中继通道与登录的续期方式（当前：过期重新登录）。
- 内置资产下发是否签名（v1 可先只靠中继鉴权 + sha256，签名作为后续加固）。
- 来源头字段的取舍。
- 中继模型端点是否强制（由以后定制决定）。
- 中继 TLS 终止位置（v1 中继终止 + 可信运营方，E2E 后置）。
- 换库已完成：hub 从 PostgreSQL 切到 SQLite（`node:sqlite` + 单文件库），按基座的 `db-sqlite` 路径执行；
  不再需要数据库容器，部署侧只保留 app 容器与应用数据卷。
