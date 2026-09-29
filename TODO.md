# TODO

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

（其余项见 README「常见问题」；已修的 review 问题不在此列。）
