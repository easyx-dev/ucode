# @ucode/ui

控制层的 React 组件与视图模型，被 Web 与桌面壳复用。

## 职责

- 提供整套界面组件：会话侧栏与对话流、输入 composer、交互对话框、任务/市场/用量/工作区/终端面板、Markdown 渲染、primitives。
- 以 zustand vanilla store 承载界面状态（`createAgentStore`），并把它挂进 React 树（`AgentStoreProvider`）。
- 把展示逻辑抽成纯函数模块（`*-format.ts`），以便单测而不必渲染。
- **不做**：不依赖任何 `apps/*`；不依赖 `@ucode/service`（数据经 SDK 拿）。宿主差异（窗口、托盘、通知、端口映射）留在各壳里。

## 公开入口

| 子路径 | 入口 | 主要符号 |
|---|---|---|
| `.` | `src/index.ts` | `AgentShell`、`AgentStoreProvider`、`useAgentStore`、`createAgentStore`、`InteractionDialog`、`ErrorBoundary`、各面板与 primitives |
| `./styles.css` | `src/styles.css` | 主题 token 与组件样式（宿主**必须**引入） |

## 用法

```tsx
import { AgentShell, AgentStoreProvider, createAgentStore } from "@ucode/ui";
import { getBrand } from "@ucode/branding";
import "@ucode/ui/styles.css";

const store = createAgentStore(sdk); // 每个宿主建自己的 store，ui 不持有全局单例

createRoot(document.getElementById("root")!).render(
  <AgentStoreProvider store={store}>
    <AgentShell productName={getBrand().productName} />
  </AgentStoreProvider>,
);
```

`useAgentStore(selector)` 必须在 `AgentStoreProvider` 内使用，否则抛错。

## 依赖位置

依赖 `@ucode/sdk`、`@ucode/protocol`、`@ucode/branding`；外部依赖 `react`、`zustand`、`react-markdown` + `remark-gfm` + `rehype-highlight` + `highlight.js`、`@xterm/xterm` + `@xterm/addon-fit`。

被依赖：`@ucode/web`、`@ucode/desktop`。TUI **不**复用本包（终端渲染与 DOM 渲染没有共同组件），它只用 `@ucode/sdk`。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/ui` 条目。

## 关键约束

- **选择器不能返回新建的数组/对象**（I-5）：否则快照恒变、React 无限重渲（表现为整页白屏）。派生数据在组件里用 `useMemo` 算。
- **主题 token 只在 `src/styles.css`**：组件只写语义类名，不硬编码颜色；此处出现的具体色值是设计意图，不算硬编码违规。
- 展示逻辑尽量抽成 `*-format.ts` 纯函数——视图层保持可单测。
- 状态用 zustand vanilla store，不在模块层创建单例：一个宿主可能同时开多个连接。

## 开发

```bash
pnpm -F @ucode/ui typecheck
pnpm test
```

本包是 `.tsx`（经 Vite / esbuild 打包），但**只有** `apps/web` 与 `apps/desktop/renderer` 会打包它。改完源码后，Web 壳必须重建（`pnpm -F @ucode/web build`）才看得到效果。
