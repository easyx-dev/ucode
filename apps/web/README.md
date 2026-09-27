# @ucode/web

Web 壳（浏览器宿主）：复用 `@ucode/ui` 的 React 界面，经 HTTP + SSE 连核心层。

## 职责

- 提供浏览器宿主的入口与打包配置（Vite）。
- 按 `location.origin` 建 HTTP/SSE 连接，以 `clientKind: "web"` 握手，渲染 `AgentShell`。
- **不做**：不依赖 `@ucode/core`（只走 `@ucode/sdk`）；界面组件本身在 `@ucode/ui` 里。

## 入口与产物

- **真实入口**：`index.html` → `src/main.tsx`（Vite 应用入口，无打包器的宿主不适用）。
- 构建产物：`dist/`，由 `pnpm -F @ucode/web build` 产出，`base` 为 `./`。
- 运行时由 CLI 的 `web` 子命令确保常驻服务在跑，服务在同一端口托管 `dist/`，于是壳与服务同源，无 CORS 与 cookie 麻烦。

> `package.json` 的 `exports["."]` 指向 `./src/index.ts`，该文件并不存在（无任何包 import 它，门禁也不校验 `exports` 指向的文件）。请以 `index.html` → `src/main.tsx` 为准。

## 运行

```bash
pnpm -F @ucode/web dev        # Vite 开发服务器
pnpm -F @ucode/web build      # 产出 dist/，服务托管的就是它
pnpm ucode web --open         # 确保服务在跑 + 打印地址（+ 开浏览器）
pnpm ucode web --foreground   # 前台把服务跑起来（旧行为，Ctrl-C 即停）
```

**改完 `apps/web` 或 `packages/ui` 的源码必须重建**：CLI 服务的是构建产物而不是源码，否则"看不到效果又看不出哪里不对"。产物比源码旧时 `resolveWebAssets()` 会打印警告。

## 依赖位置

依赖 `@ucode/ui`、`@ucode/sdk`、`@ucode/branding`；外部 `react`、`react-dom`（开发依赖 `vite`、`@vitejs/plugin-react`、`@tailwindcss/vite`）。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/web` 条目。

## 关键约束

- **不得依赖 `@ucode/core`**：只通过 `@ucode/sdk` 的传输子路径连核心层。
- 只 import 自己那一份传输（`@ucode/sdk/http`），`node:net` / `node:child_process` 不能进打包结果。
- 样式必须引入 `@ucode/ui/styles.css`（主题 token 的唯一载体）。
- `index.html` 里的标题等品牌信息属门禁不扫的位置（`.html`），须人工与 `brand.json` 保持同源。

## 开发

```bash
pnpm -F @ucode/web typecheck
```
