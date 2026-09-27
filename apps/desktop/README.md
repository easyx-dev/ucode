# @ucode/desktop

桌面壳（Electron）：主进程 spawn 核心层，渲染进程复用 `@ucode/ui`。

## 职责

- 主进程：spawn 核心层子进程（stdio 绑定），把渲染进程的协议消息经 IPC 桥到子进程 stdin，把 stdout 按字节切行后推给渲染进程；开窗口、装托盘、发系统通知、持有 `powerSaveBlocker` 与 `safeStorage` 凭据、内置浏览器窗口。
- preload：在沙箱里向渲染进程暴露 `window.desktopBridge`（消息收发、核心层退出通知、环境信息、保持唤醒、通知、凭据读写、打开浏览器）。
- 渲染进程：复用 `@ucode/sdk` + `@ucode/ui`，传输是 IPC 而非 HTTP。
- **不做**：主进程**不 import 核心层**——它只 spawn。核心层进不了渲染进程的依赖树。

## 三层产物

| 产物 | 路径 | 说明 |
|---|---|---|
| 主进程 | `main.mjs` | **纯 JS，无 TS 语法**：Electron 直载，不经打包器，类型剥离不适用 |
| preload | `preload.cjs` | **必须是 CommonJS**：沙箱 `require` 只认 `electron` 与少数内置模块，`node:fs` 都不可用，因此品牌配置由主进程读、经 IPC 递给渲染进程 |
| 渲染进程 | `dist-renderer/` | Vite 产物，`base` 为 `./`（`file://` 下加载） |
| 核心层单文件 | `core-bundle/cli.mjs` | esbuild 打包 CLI 入口，基座 / ws / jiti 保持 external；**输出必须 esm**（cjs 会因基座顶层 await 失败） |

打包时 `core-bundle/` 走 `asarUnpack` 拆出 asar（asar 里无法 exec），主进程按打包布局解析路径。

## 运行

```bash
pnpm -F @ucode/desktop start          # 开发态起 Electron
pnpm -F @ucode/desktop smoke          # 无头冒烟：8s 后截图退出
pnpm -F @ucode/desktop build          # 只出渲染进程产物
pnpm -F @ucode/desktop bundle-core    # 只出核心层单文件
pnpm -F @ucode/desktop dist           # 渲染进程 + 核心层 bundle + electron-builder --dir
```

签名/公证/dmg 属发布流程（`.github/workflows/release.yml`），凭据全走 secrets；缺凭据时只产出未签名包、不失败。

## 依赖位置

依赖 `@ucode/sdk`、`@ucode/ui`；外部 `react`、`react-dom`（开发依赖 `electron`、`electron-builder`、`vite`、`esbuild`）。

权威来源：[tools/boundaries.json](../../tools/boundaries.json) 的 `@ucode/desktop` 条目。

## 关键约束

- **主进程与 preload 不能有 TS 语法**（主进程 `.mjs`、preload CommonJS）——由 Electron 的加载方式决定，不是风格选择。
- **OS 凭据只在加密可用时存**（`safeStorage`）：加密不可用就**拒存**，宁可不存也不落明文；明文不落盘、不进日志。
- 退出时要优雅关停核心层，释放 owner 租约。
- 品牌配置由主进程读取（解析 `@ucode/branding/brand.json`）后经 IPC 递给渲染进程，两处都不写死品牌。
- `electron-builder.yml` 里出现的 `appId` / `productName` 属门禁不扫的位置，须人工与 `brand.json` 同源。

## 开发

```bash
pnpm -F @ucode/desktop typecheck
```
