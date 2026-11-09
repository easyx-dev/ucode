# 插件界面贡献

插件可以改变界面：多一个工作台视图、按扩展名接管某类文件、提供会话模式、给设置页加一块面板。
方案与里程碑见 [`plans/plugin-ui.md`](../plans/plugin-ui.md)；安装、启停与信任档见
[plugins.md](./plugins.md)。

## 能力与边界

| 项 | 说明 |
| --- | --- |
| 运行形态 | 插件随包提供**预构建 ESM + CSS**，服务端从安装目录托管，渲染层 `import()` |
| 信任档 | 只有 `official` 与 `local` 会注入；第三方市场的插件界面不注入，设置页会标注原因 |
| 能力面 | `@ucode/plugin-api`：React、UI 原语、白名单动作、i18n、宿主上下文、自有接口与事件。**拿不到 SDK client** |
| 版本 | 清单 `ui.apiVersion` 必须等于宿主的 `PLUGIN_UI_API_VERSION`，否则整段跳过并出诊断 |

## 清单

```json
{
  "name": "my-plugin",
  "ui": {
    "apiVersion": 1,
    "styles": ["./dist/ui/view.css"],
    "views": [
      {
        "id": "board",
        "label": "看板",
        "icon": "boxes",
        "layout": "full",
        "order": 10,
        "module": "./dist/ui/view.mjs",
        "export": "BoardView"
      }
    ]
  }
}
```

- 路径必须以 `./` 开头，且落在插件根内（符号链接逃逸同样拒绝）；模块只认 `.mjs` / `.js`，样式只认 `.css`。
- `icon` 取宿主约定的少数 lucide 名（`layout-template`、`square-terminal`、`folder-tree`、
  `git-compare`、`app-window`、`boxes`），认不出时回落通用图标。
- `label` 由插件负责本地化，宿主不再翻译它。
- `layout`：`full` 占满主区（自带清单与画布这类界面用它）；`sidebar` 目前按 `full` 处理，插件侧栏尚未实现。

## 组件

模块导出一个 React 组件（导出名由 `export` 指定，缺省取 `default`），props 是：

```ts
type PluginUiComponentProps = {
  host: { pluginId: string; sessionId: string | null; cwd: string | null; language: string };
  narrow: boolean; // 窄屏 / 触屏
  path?: string;   // 文档渲染器专有：被打开的文件路径
};
```

渲染抛错会被宿主的错误边界吃掉，只影响这一块界面。

## 运行时

```tsx
import type { PluginUiComponentProps } from "@ucode/plugin-api";
import { actions, i18n, react, ui } from "@ucode/plugin-api";

export function BoardView({ host, narrow }: PluginUiComponentProps) {
  const [count, setCount] = react.useState(0);
  return (
    <ui.ScrollArea>
      <ui.Button size="sm" onClick={() => { setCount(count + 1); actions.notify(`点了 ${count + 1} 次`, "success"); }}>
        {i18n.t("点我")}
      </ui.Button>
    </ui.ScrollArea>
  );
}
```

- `ui`：`Button` / `IconButton` / `Empty` / `Spinner` / `ScrollArea` / `FloatingPanel` / `Tooltip*` /
  `DropdownMenu*` / `ContextMenu*`——与宿主同一套实现，token、圆角、暗色模式自然一致。
- `react`：宿主那一份 React。**不要自带 React**，否则 hooks 会报 Invalid hook call。
- `hooks.useIsDesktop()`：与宿主同一断点。
- `actions`：`openFile` / `openView(pluginId, viewId)`（插件 id 要显式给：动作表是所有插件共用的一份）/ `collapse` / `notify`。
- `i18n.t(key)`：key 就是中文原文，缺英文时回落原文。

## 服务端模块与数据面

界面要数据就得有个服务端：清单声明 `server`（预构建 ESM 入口），宿主在进程内**加载一份**并按需调用。

```json
{
  "server": "./dist/server.mjs",
  "tools": ["my_plugin_query"]
}
```

```ts
// server/index.ts —— 导出的都是可选函数
export const createRoutes = (ctx) => new Hono().post("/items", async (c) => ({ items: [] }));
export const createTools = (ctx) => [ctx.pi.defineTool({ name: "my_plugin_query", ... })];
```

宿主交给插件的 `ctx`：

| 字段 | 用途 |
| --- | --- |
| `dataDir` | 插件自己的持久目录（跨版本保留） |
| `config` | 用户在插件卡片里填的 `userConfig` 值 |
| `sessions.find(id)` | 只读会话信息（`cwd` / `name`），不要拿它做事 |
| `sessionState` | 会话级键值（插件自有数据，按 `pluginId` 隔离，重启后仍在） |
| `events.emit(sessionId, type, payload)` | 发插件自有事件，界面用 `events.on` 收 |
| `pi.defineTool` / `pi.resizeImage` / `pi.detectSupportedImageMimeTypeFromFile` | 宿主的能力注入（插件产物解析不到这些包） |
| `logger` | 写日志，前缀带插件 id |

- 接口挂在 `/api/v1/plugins/<id>/api/*`，插件看到的是自己根下的路径；**响应是普通 JSON，不套宿主封套**（协议由插件定）。
- 插件界面用 `http.call(pluginId, "items", body)` 调它；`events.on(pluginId, handler)` 订阅自己的事件。
- 清单 `tools` 声明自有工具名：角色文件的 `tools` 白名单里写它们才不会被当成「不认识的名字」丢掉。
- 第三方市场的插件不加载服务端模块（与 hooks / extensions / 界面同一道门控）。

## 引用锚点（mention）

插件可以给方言注册一种引用锚点：`@<scheme>:<payload>`。宿主负责三件事——不当文件引用、
在输入框里落成芯片、在消息气泡里显示成芯片；`payload` 的语义与归属校验都在插件那边（工具按它认对象）。

```json
{ "ui": { "mentions": [{ "scheme": "design" }] } }
```

- 只声明 `scheme` 即可：芯片由宿主通用渲染（短名 + 悬停露出锚点原文）。
- 需要专门呈现（缩略图、状态点）时再给 `module` + `export`，指向插件自己的芯片组件——
  **这一步的宿主侧还没接**（当前一律用通用芯片），清单里声明了也不报错，只是暂时不生效。
- 插件用 `actions.insertMention({ scheme, label, anchor })` 往输入框落一枚；用户仍可编辑。

`@` 引用文件的那套不受影响：`@docs/a.md` 没有 scheme，照旧当文件引用；只有表里的 scheme 才按锚点处理，
所以 `@design:s-1/1:2` 不会被当成去磁盘上找一个叫 `design:s-1/1:2` 的文件。

## 主模式

插件可以贡献一个会话主模式：`agents/<name>.md` 写 `mode: primary`，清单 `ui.modes` 给选择器用的图标与文案。

```md
---
name: my-mode
mode: primary
description: 一句话说明这个模式能做什么
tools: Read, Grep, my_plugin_query
---

（提示词正文：这个模式的约束与工作方式）
```

清单里 `ui.modes[].slug` 写**角色文件的 name**（宿主会换成登记后的 slug，带插件前缀），
会话的 `mode` 就是那个 slug。插件模式排在内置模式之后。

## 构建

插件代码要预构建（宿主不做编译）。官方插件仓里跑：

```
cd plugins && pnpm install && pnpm build
```

约定：`ui/<file>.tsx` → `dist/ui/<file>.mjs`，`ui/<file>.css` → `dist/ui/<file>.css`，
`server/index.ts` → `dist/server.mjs`。三个宿主模块名（`react`、`react/jsx-runtime`、`@ucode/plugin-api`）
一律 external，其余第三方依赖打进产物。

## 样式

插件自带 CSS，用宿主的设计 token：

```css
.plugin-board__inner {
  padding: calc(var(--spacing) * 4);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
```

**运行时安装的插件不能用 Tailwind 类名**：宿主构建期只扫自己的源目录，插件写的新类名不会有对应规则。
随包插件与宿主同一次构建，可以例外。

## 官方的设计插件

`plugins/plugins/design` 是把内核原有的设计功能整体搬进插件的实例，可以当成「带界面 + 带数据面」的完整参考：

- 清单：一个 `layout: "full"` 视图、一个 `.design` 文档渲染器、`design` 主模式、`design_*` 工具名；
- 服务端：文档按路径缓存（`server/index.ts`）、接口（`server/routes.ts`）、工具（`server/tools.ts`）、
  指针存在会话状态里（`ctx.sessionState`）、刷新走 `ctx.events.emit`；
- 界面：视图与文档渲染器各一个入口（`ui/view.tsx`、`ui/doc.tsx`），内部组件复用宿主原语（`@ucode/ui/base/*`）；
- 构建：清单声明的入口各自打成一个 ESM（`./dist/ui/view.mjs`、`./dist/ui/doc.mjs`），内部模块打进去。

它复用宿主 UI 原语这件事**只在官方插件里成立**（`pnpm plugins:build` 以根仓为工作目录、把 `@ucode/ui`
别名到源码）。第三方插件只能用 `@ucode/plugin-api` 暴露的能力面。

设计插件走官方市场安装，因此它的产物（`dist/`）与源码一起提交在插件仓里：市场按 git 快照安装，
宿主只认预构建 ESM，不会在安装时编译。

## 已知边界

- **插件服务端模块没有会话生命周期回调**：内核的「会话出池 / 归档」通知到不了插件，所以设计插件的文档
  一直留在内存里（按文件路径缓存，数量等于打开过的稿子），落盘仍由防抖写盘与 `flush` 兜住。
- **插件文案不做英文**：插件界面用宿主 `t`（key 即中文原文），en 目录里没有这些 key，英文界面显示中文。

## 调试

1. 设置 → 插件，填插件目录的绝对路径安装（本地目录来源不复制内容，改完点「重拉」）；
2. 活动栏上多出的图标即插件视图；加载失败时界面会提示去看插件诊断；
3. 诊断里有「界面运行时版本不一致」「模块不存在」「后缀不受支持」这类逐条说明。
