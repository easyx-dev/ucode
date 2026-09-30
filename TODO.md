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

## 新功能探索与思考
内置一系列的工具 tools，提示词命令（prompt），skiil
系统提示词（不使用 pi 的）提示词内容可以参考 opencode 是怎么写的
## 内置工具
### grep
使用正则表达式搜索文件内容。

### find
通过模式匹配查找文件。

### 网络搜索 websearch/webfetch
https://pi.dev/packages/pi-web-access

### question
https://pi.dev/packages/@juicesharp/rpiv-ask-user-question

## MCP 支持
https://pi.dev/packages/pi-mcp-adapter

## 子智能体
参考 https://pi.dev/packages/pi-subagents

## TODO 工具
https://pi.dev/packages/@juicesharp/rpiv-todo

## wiki
https://pi.dev/packages/openwiki?name=wiki

## 权限控制
https://opencode.ai/v2/docs/permissions/
https://pi.dev/packages/@gotgenes/pi-permission-system

## plan 模式(计划模式)
参考 opencode 的计划模式 和 https://pi.dev/packages/@narumitw/pi-plan-mode?name=plan

## 助手模式（ask）
最终设计已定稿，见 [`plans/agent-tools-and-modes.md`](./plans/agent-tools-and-modes.md)：模式 slug 用 `ask`（界面文案「问答」），
模式与工作区解耦，工作区为 `$APP_HOME/workspace/<sessionId>/{uploads,outputs}`，只承诺只读工具集（禁 `bash`），不承诺只读权限。

## goal 模式(目标模式)
https://pi.dev/packages/@schovest/pi-goal
也可以参考 claude code ，zocode，codex 的
https://zcode.z.ai/cn/docs/goal

## 项目级记忆（Memory）
有些信息只值得告诉 Agent 一次：你习惯的 commit message 写法、项目用的包管理器、团队的评审约定。Memory 为 UCode Agent 提供项目级的长期记忆，让这类信息延续到后续会话，而不需要每次对话开头都重复交代。

开启后，UCode 会在每轮对话成功结束后于后台回顾最近的交流，判断是否有值得长期保留的内容——你的偏好、用户对 Agent 工作方式的纠正、项目目标与约束、你提供过的外部资料。保存下来的记忆会在同一项目的后续会话中自动带入上下文。

也可以在对话中直接管理记忆：说「记住，我们从 staging 分支发布」即可立刻保存；说「忘掉刚才说的发布分支」即可删除对应记忆。

### 会记住什么
Memory 聚焦四类信息：

类型	覆盖内容	示例
用户	你的身份、专长和偏好	「习惯用 pnpm 和 Conventional Commits」
反馈	对 Agent 工作方式的纠正或确认	「不要顺手修改无关文件里的 lint 报错」
项目	项目目标、约束与进展	「站点需要保持兼容 Node 20」
参考	你提供过的外部资源	「设计规范在团队 Wiki 的某个链接」

同样重要的是 Memory 刻意不记的内容：代码结构和 Git 历史（Agent 随时可以重新读取）、项目指令文件里已有的内容，以及只在当前对话内有效的临时信息。

### 工作机制
一轮对话成功结束后，后台流程会回顾最近的交流。如果发现值得保留的信息，就把它写成一个小的 Markdown 事实文件，并更新 MEMORY.md 索引；没有则什么都不保存。整个过程发生在你的回合结束之后，不会拖慢对话本身。

在同一项目的后续会话里，索引会自动加载进 Agent 的上下文，无需任何手动操作。记忆按项目隔离：UCode 在一个工作区学到的内容不会带到另一个工作区。

记忆存在哪里
记忆是保存在你本机的普通 Markdown 文件：

~/.ucode/app/memory/projects/<project>/memory/
├── MEMORY.md        # 索引，一行一条
└── *.md             # 每条事实一个文件

## 编辑历史对话
https://zcode.z.ai/cn/docs/edit-history

## 使用统计


（其余项见 README「常见问题」；已修的 review 问题不在此列。）

