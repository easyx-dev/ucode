# @ucode/desktop — 桌面壳（Electron）

桌面壳是**客户端**，与 web / tui 同一条路子：主进程确保**共享服务**在跑，窗口加载的界面
**由服务的 HTTP 端点同源发出**——也就是说，桌面与浏览器里跑的是**同一份 Web 产物**
（`@ucode/web/dist`，随 `core-bundle/web-assets` 分发）。因此没有 CORS、没有跨站 cookie 问题，
界面也永远与 Web 壳一致。

## 主进程做什么

| 步骤 | 说明 |
|---|---|
| 确保服务 | 读 `<数据根>/runtime/service.json` → 进程活着且给出 `http` 端点就复用；否则用打包好的 CLI（dev 直跑源码）spawn 一个 **detached** 的 `service start`，轮询注册表等它就绪 |
| 开窗口 | `loadURL(<服务 http 端点>)`，preload 注入本机能力 |
| 本机能力 | 托盘与菜单、系统通知、`safeStorage` OS 凭据（加密不可用拒存）、`keepAwake`→`powerSaveBlocker`、内置浏览器窗口 |
| 退出 | **不杀服务**：它是与 web / tui 共享的后端（一个数据根一个服务），停止用 `ucode service stop` |

## 产物

| 产物 | 说明 |
|---|---|
| `main.mjs` / `preload.cjs` | 主进程与桥（纯 JS，Electron 直载，不经打包器；preload 必须是 CommonJS） |
| `core-bundle/cli.mjs` | esbuild 打包的服务层 CLI 单文件（基座 / ws / jiti / node-pty 保持 external，由自带的 `node_modules` 提供；**输出必须 esm**） |
| `core-bundle/web-assets/` | Web 壳产物副本：打包形态下服务层发不出界面就白屏，主进程用 `--web-assets` 把位置告诉它 |

```bash
pnpm -F @ucode/web build          # 先有 Web 产物（bundle-core 会把它拷进 core-bundle）
pnpm -F @ucode/desktop start      # 开发态直接起（直跑源码的 CLI）
pnpm -F @ucode/desktop smoke      # 冒烟：等界面连上服务 → 截图 → 退出
pnpm -F @ucode/desktop dist       # bundle-core + electron-builder --dir
```

## 依赖边界

**主进程不 import 服务层**：它只 spawn CLI；界面经 HTTP 连服务端点。桌面包的运行时依赖只有
`@ucode/branding`（读 `brand.json`，不写死产品名与目录名），因此反向验收（壳的依赖树里不得
出现 `@ucode/service`）天然成立。

## 环境变量

`<产品名大写>_DATA_DIR` 指定数据根、`<产品名大写>_CWD` 指定会话默认工作目录
（冒烟与多环境测试用）。
