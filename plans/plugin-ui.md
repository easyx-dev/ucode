# 插件界面（UI 贡献）方案

状态：**M1 / M2 已落地，M3 的 design 抽离已完成**（内核那份设计实现已删除，设计随包插件接管）。
遗留的小尾巴在文末「已知边界」。作者向的说明见 [`docs/plugin-ui.md`](../docs/plugin-ui.md)。

## 目标与不变量

1. **插件能改变界面**，而不只是贡献资源：工作台视图、编辑器文档渲染器、会话模式、输入区与消息锚点、
   设置页分区、插件自有数据面。
2. **代码运行时加载**：插件随包提供预构建 ESM + CSS，服务端托管、渲染层 `import()`；宿主不做编译。
3. **能力面用「不暴露」保证**：插件只拿到 `PluginUiApi`（React、UI 原语、白名单动作、i18n、宿主上下文），
   拿不到 SDK client，也没有裸 `fetch`。
4. **与既有信任档一致**：`ui` / `server` 进 `PLUGIN_EXECUTABLE_GROUPS`，第三方市场来的只出诊断、不注入
   ——界面代码拿的是渲染层的能力，风险与 hooks / extensions 同档，不因为「只是界面」放宽。
5. **宿主 API 版本化**：`PLUGIN_UI_API_VERSION` 与清单 `ui.apiVersion` 不等时整段跳过并出诊断。

## 形状

```
插件包(磁盘)                          服务端(内核)                          渲染层(内核)
.ucode-plugin/plugin.json  ──►  harness/plugins/ui.ts（解析声明、校验路径）
ui/*.tsx → dist/ui/*.mjs           ──► routes/plugins（托管 + 改裸模块名）──► provider/plugin-host.tsx
ui/*.css → dist/ui/*.css           ──► /api/v1/plugins/<id>/ui/<path>?ticket=…    ├─ 动态 import
server/*.ts → dist/server.mjs      ──► （M2：进程内加载，自有路由与工具）         └─ plugin-api.ts（运行时）
```

### 模块加载

- 插件模块里 `import { ui, actions } from "@ucode/plugin-api"`、`react`、`react/jsx-runtime` 三个裸模块名
  在**托管时**被改写成宿主 shim 的地址（`/api/v1/plugins/runtime/*.js`），其余源码原样发出。
  不用 import map：源码运行、打包产物、桌面端 `app://`、中继路径前缀四种形态都能落在同一条路上，
  插件内部的相对 import 也照常工作。
- shim 只做转发，逻辑全在宿主：`packages/ui/src/provider/plugin-api.ts`。
- **插件不许自带 React**：两份 React 会让 hooks 立刻报 Invalid hook call。

### 鉴权

`import()` 与 `<link>` 带不了 `Authorization`，所以资源走查询票：`POST /api/v1/plugins/ui` 随贡献清单
下发一张 10 分钟的票，客户端把它与 `?v=<revision>` 一起拼到模块 / 样式地址上；鉴权中间件只对
`/plugins/<id>/ui/*` 与 `/plugins/runtime/*` 这两类 GET 认票（见 `services/plugins/assets-tickets.ts`）。

### 样式

插件自带 CSS，用宿主的设计 token（`var(--color-*)` / `var(--radius-*)` / `var(--text-*)`）。
**运行时安装的插件拿不到宿主的 Tailwind 生成**（类名在构建期扫描而来），必须自带编译好的 CSS；
随包插件与宿主同一次构建，可以例外（`@source` 扫它的源目录）。

## 落位

| 位置 | 职责 |
| --- | --- |
| `packages/contracts/src/plugins/ui.ts` | 贡献点契约、`PLUGIN_UI_API_VERSION`、`PluginsUiResponse` |
| `packages/plugin-api/` | 插件作者的运行时类型与 shim 声明（只有类型） |
| `packages/ui/src/provider/plugin-api.ts` | 运行时 API 的类型与全局安装点（公开面 `@ucode/ui/plugin`） |
| `packages/ui/src/provider/plugin-host.tsx` | 取清单、加载模块、错误边界、样式注入、视图与文档渲染落点 |
| `server/src/harness/plugins/ui.ts` | 清单 `ui` 段落解析、路径校验、声明 → 契约映射 |
| `server/src/harness/plugins/ui-runtime.ts` | 三个 shim 的源码字符串 |
| `server/src/routes/plugins/index.ts` | 贡献清单、模块与样式托管、shim 分发 |
| `plugins/`（submodule） | 官方插件仓：`plugins/<name>/` 与构建脚本 `scripts/build.mjs` |

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 契约 + 托管 + 宿主 | 视图贡献端到端（示例插件 `ui-showcase` 已在 dev 环境验证：活动栏入口、整块主区、宿主原语、白名单动作、自带样式） | 已完成 |
| M2 数据面 + 主模式 | 插件自有路由（`/plugins/<id>/api/*`，剥前缀转交 + 普通 JSON）、插件工具（清单 `tools` 声明 + 装配按名字过滤）、会话级插件状态（`session_plugin_state`，表 v13）、`plugin_event` 帧、插件主模式（`mode: primary` + `ui.modes` 文案与图标，选择器已接）、界面侧 `http.call` / `events.on` | 已完成 |
| M2 mention | 已完成：方言的锚点 scheme 由插件声明（`ui.mentions`），内核只做「不当文件引用 / 落芯片 / 显示芯片」，芯片由宿主通用渲染（也可由插件自带组件）；`packages/markdown` 的 `design-anchor` 换成通用的 `mention-anchor`，composer 的 `designNode` 与消息气泡里的设计专用组件一并泛化 | 已完成 |
| M2 其余贡献点 | 待做：设置分区、`i18n.addResourceBundle`、只读 store 订阅；**发布 `@ucode/plugin-api`**（当前插件仓的界面源码只构建、不做类型检查：跨仓 install 会带进第二份 React 类型） | 待做 |
| M3 design 抽离 | 已完成：设计整体搬进 `plugins/plugins/design`（视图 + `.design` 文档渲染器 + `design` 主模式 + `design_*` 工具；服务端自带文档 / 变更 / 图片 / 路由 / 工具，数据面走插件接口、指针走会话状态、刷新走插件事件）；内核那头删掉了 `harness/features/design`、`routes/design`、`contracts/design`、`sdk/stores/design`、`ui/business/workbench/design`、`constants/design`、`profiles.design` 与 prompt 的 design 段、`preview` 的 design 类型、`design_update` 帧、`session.design_path`（v14 删列），插件经官方市场按需安装（设计也是），产物随插件仓提交 | 已完成 |

## 已知边界

- `ui.layout` 的 `sidebar` 取值保留但未实现：插件视图一律占满主区，插件侧栏留到 M2。
- `api.i18n.addResourceBundle` 目前是空实现：插件文案先靠「key 即中文原文 + 宿主兜底插值」。
- 随包插件登记（`services/plugins/packaged.ts`）已就位，但 `PACKAGED_PLUGINS` 里的 `design` 目录在 M3 之前
  不存在，登记是空操作——这是刻意的，避免产品里出现两块设计入口。
