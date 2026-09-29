# TODO

## 待查 · `.tmp/.ucode/app/config.json` 与 `.tmp/.ucode/pi/models.json` 为什么各存一份模型配置

两者是**源文件与派生产物**的关系，不是互为备份：

- `app/config.json`：应用配置的唯一事实源，由 `ConfigStore`（`server/src/config/store.ts`）读写，`POST /api/v1/config/update` 落盘。内容含 `providers` / `defaultModel` / `thinkingLevel`——后两项是应用自己的概念，pi 不认。
- `pi/models.json`：pi `ModelRuntime` 认的模型目录格式，由 `PiRuntime.apply()`（`server/src/core/runtime.ts:40`）在每次配置变更时用 `toModelsJson()` 全量重写，再交给 `ModelRuntime.create({ modelsPath })` 加载。

所以是单向派生：`config.json --toModelsJson()--> models.json`。两份都要，是因为 pi SDK 没有「直接注入 provider 配置」的入口——`ModelRuntime.create()` 只接受 `modelsPath`（模型目录文件）与 `authPath`（凭证），provider 的 `baseUrl` / `apiKey` / `models` 只能从 models.json 读（内部走 `ModelConfig.load(modelsPath)`）。`create()` 上的 `modelsStore` 选项缓存的是远端目录（按 provider id 存 `Model<Api>[]`），不能替代 provider 配置。

两份文件的差异：

| 字段 | `app/config.json` | `pi/models.json` |
| --- | --- | --- |
| `providers` | 数组 | 以 id 为键的对象 |
| `defaultModel` / `thinkingLevel` | 有 | 无（pi 不需要，由应用消费） |
| `compat` | 不写 | 每个模型补 `supportsDeveloperRole: false` |
| provider 级 `headers` | 有 | 透传 |

**待办**：

1. 确认 pi 是否真的没有「内存注入 provider 配置」的入口（`getRegisteredProviderConfig` / `nativeExtensionProviders` 一带）。若有，就不必落第二份文件，顺带少一份明文 `apiKey`。
2. `PiRuntime.apply()` 用 `writeFileSync` 直接覆写 `models.json`，没有 `config.json` 那样的 `tmp + rename` 原子写；进程中断或并发时可能留下半截 JSON，pi 下次启动解析失败。考虑对齐 `ConfigStore.set()` 的原子写。
3. 两份文件都在 `APP_HOME`（同时是 agent 的工作目录）内且含明文 `apiKey`，agent 自带 `read` 权限即可读到自己的 key。是否改用 pi 的 `authPath` / `setRuntimeApiKey` 把凭证从 models.json 挪走，需要评估。

---

## P0 · 给 `/api/v1` 加鉴权，并默认只监听回环地址

**现状（已在真实运行实例上验证）**：`server/src/index.ts` 的 `serve({ fetch: app.fetch, port: env.port })` 未指定 `hostname`，Node 绑定 `::`（所有网卡）；`app.use("*", cors({ origin: env.corsOrigin }))` 的默认值是 `*`；整个 `server/src` 没有任何请求级鉴权（只有 pi 自己的 `authPath`）。

实测：

```
curl http://192.168.1.149:2048/api/v1/health            → 200            # 同网段任意机器
curl -X POST http://192.168.1.149:2048/api/v1/models/list → 200（返回配置）
curl -i -X OPTIONS http://192.168.1.149:2048/api/v1/messages/prompt \
     -H 'Origin: https://evil.example' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: content-type'
     → 204, access-control-allow-origin: *
```

**风险**：agent 带 `read` / `write` / `edit` / `bash`，`APP_HOME` 指向真实仓库时，同网段任何人都能通过 HTTP 让它执行命令并读回结果；用户浏览任意网页时，该网页也能驱动本地服务（CORS 用 `*` 放行了预检）。

**待办**：

1. `/api/v1` 加 token 鉴权（`Authorization: Bearer <token>` 或 `X-Api-Token`）。token 首次启动随机生成，写入 `$APP_HOME/token`（0600）并打印到启动日志；`GET /api/v1/health` 放行。
2. 默认只监听回环：`serve({ fetch: app.fetch, port: env.port, hostname: process.env.HOST ?? "127.0.0.1" })`，需要局域网访问时用 `HOST=0.0.0.0` 显式开启。
3. `APP_CORS_ORIGIN` 默认改为 dev 下的 vite 源（`http://localhost:5173`），不再默认 `*`。生产是 server 同源托管 `apps/web/dist`，不依赖 CORS，收紧不会破坏部署。
4. 前端 `apps/web/src/lib/api.ts` 统一带上 token（存 localStorage 或构建时注入），设置页加一个 token 输入框。
5. `.env.example` / `README.md` 补 `HOST`、`API_TOKEN` 说明，并提示"不要把带 shell 权限的 agent 暴露到公网"。

**验收**：同网段 `curl http://<LAN-IP>:2048/api/v1/health` 连不上（默认回环）；带上正确 token 才能调用其他接口；无 token 返回 401；带 `Origin: https://evil.example` 的预检不再返回 `allow-origin: *`。

---

## BUG · 新会话发消息后没有即时 loading；首轮回答完成前刷新会丢失该会话

**现象**：

1. 新建会话发送首条消息后，消息区要等几秒才出现「思考中…」，这几秒内没有任何加载反馈。
2. 首轮回答还没结束时刷新页面，侧栏里找不到这个会话；等后台把这轮回答跑完才出现。

**根因**：

1. 「思考中…」只在存在 live 的 assistant 条目、且其 `blocks` 为空时渲染（`apps/web/src/components/message-item.tsx:81`），而这条 assistant 条目要等首个活动事件（`message_start` 等）才插入（`apps/web/src/lib/chat-reducer.ts:142`）。发送侧的 `sending` 只覆盖 `POST /messages/prompt` 的在途时间（`apps/web/src/hooks/use-send-message.ts:25`），服务端 `admitPrompt` 受理后立即返回、不 await 整轮生成（`server/src/core/run.ts:68`），`running` 又要等首个活动事件才置 true（`apps/web/src/hooks/use-session-stream.ts:57`）。于是「prompt 返回」到「首个事件到达」之间是空窗：`streaming = running || sending` 为 false，消息区没有任何生成中提示。空窗时长≈模型/网关吐出首个 token 的延迟（新会话还要先 `pool.ensure` 建 AgentSession）。

2. 新会话在首轮 assistant 回复写入 JSONL 之前只是「草稿」：前端草稿只存在 `useSessionList` 的内存 `local` 里（`apps/web/src/hooks/use-session-list.ts:57`），刷新即丢；服务端 `/sessions/list` 只查 `persisted = 1 AND source_path IS NOT NULL`（`server/src/db/session-repository.ts:212`），而会话文件要到首轮回复才落盘（`server/src/core/session-index.ts:38`）。DB 里其实已有 `persisted = 0` 的草稿行，只是被列表过滤掉了。run 结束后 `pool.refreshIndex` 把索引刷成 persisted、前端 `onSettled` 再 refresh，会话才冒出来。

**待办**：

1. 发送时立即乐观插入一条 live 的 assistant 占位，或把生成态统一收敛成 `sending || running || pending`，在消息区尾部渲染 pending 指示，覆盖 `sending` 结束到首个事件之间的空窗；`pending` 在首个活动事件或 `agent_settled` 时消除。
2. 让刷新后能找回在途会话：`/sessions/list` 纳入 `persisted = 0` 的草稿行（带 `running` 标记），或新增「运行中会话」查询；前端把当前会话 id 落到 URL / localStorage，刷新后按 id 重新 hydrate。
3. （可选）评估 `/create` 直接写会话文件 header，从根上消掉「草稿」这个中间态。

---

（其余项见 README「常见问题」；已修的 review 问题不在此列。）
