# ucode

基于 [pi.dev](https://pi.dev)（Earendil Inc. 的 Pi agent harness）构建的**分层智能体**。

**服务层是调度中心**：它把 pi 当作**库**在进程内嵌入（调用并扩展 pi——工具、斜杠命令、子智能体
都是 pi 之上的能力），自己也持有状态（SQLite + pi 兼容的会话文件），对控制层的壳只暴露协议接口。
一台机器上的数据是**一个目录**；Web / 桌面 / TUI 三壳共享同一个常驻服务，都是客户端。

```
控制层   apps/web · apps/desktop · apps/tui     壳：渲染 + 输入 + 宿主差异
   │      @ucode/sdk（四种传输的客户端，headless）
   │      协议 C：命令 · 事件 · 交互 · 通道
服务层   @ucode/service                          唯一后端：会话 · 闸门 · 交互 · 存储 · 业务模块
   │      pi（库，进程内嵌入）
数据层   <数据根>/{runtime, v1/{service,pi}}      运行时状态 + SQLite + pi agent-dir
```

## 快速开始

```bash
pnpm install

pnpm ucode web        # 拉起常驻服务并在浏览器打开（改前端源码后需 pnpm -F @ucode/web build）
pnpm ucode tui        # 终端里的壳（同样连本机服务）
pnpm -F @ucode/desktop start      # 桌面壳（Electron；同样连本机共享服务）
pnpm ucode service status | stop | logs -f     # 管理那个常驻服务
```

服务层可脱离控制层单独跑（嵌入式 stdio 形态）：`pnpm ucode service start --foreground --stdio`。

## 仓库结构

```
packages/
├── protocol/    @ucode/protocol   线契约：命令/事件/交互/通道 + 能力与信任（叶子）
├── branding/    @ucode/branding   品牌参数与路径名（叶子）
├── service/     @ucode/service    服务层：宿主 · 传输 · 会话 · 闸门 · 交互 · 存储 · 业务模块
├── sdk/         @ucode/sdk        控制层 SDK + 四种传输的客户端
└── ui/          @ucode/ui         React 组件与视图模型（只被 web / desktop 复用）
apps/
├── cli/         启动器与 bin：ucode
├── web/         Vite 应用（产物由服务的 HTTP 传输同源发出；桌面壳加载的也是它）
├── desktop/     Electron 主进程：确保共享服务在跑 + 开窗口加载服务端点的界面
└── tui/         终端宿主（复用基座 pi-tui，只依赖 sdk）
hub/             uhub 骨架（可整包删除）
tools/ tests/    门禁 + 验收 / 跨包端到端
docs/  架构总览 · 实现设计 · 服务层内部 · 代码审查（历史基线在 docs/archive/）
```

## 质量门禁

```bash
pnpm check       # 类型 + Biome + 依赖边界 + 品牌字面量 + 全量测试
pnpm build:libs  # 产出各库包 dist（安装/发布形态）

node tools/acceptance-service-standalone.ts   # 独立安装：握手 → 建会话 → 对话 → 取历史
node tools/acceptance-reverse.ts              # 反向：壳的生产依赖树里没有 @ucode/service
```

## 文档

- [AGENTS.md](AGENTS.md)：规则本体（唯一自动加载）
- [docs/01-实现设计.md](docs/01-实现设计.md)：仓库组织、磁盘布局、存储分治、落地记录 I-n
- [docs/00-架构总览.md](docs/00-架构总览.md)：分层、依赖方向、信任级别
- [docs/02-服务层内部.md](docs/02-服务层内部.md)：服务层各子系统的职责与不变量
- [docs/archive/](docs/archive/)：历史基线（重构前的定稿需求与 ADR）
- [docs/03-代码审查.md](docs/03-代码审查.md)：代码审查规范

## 品牌

上游默认：产品名 `ucode`，数据根 `~/.ucode`，中继服务 `uhub`。产品名、数据根目录名、appId、
厂商名、URL scheme 都是**品牌参数**（构建期注入）：B 端定制 = 换一份 `packages/branding/brand.json`
与 `assets/` 重新构建，代码与协议不动（见 [ADR-023](docs/archive/02-决策记录.md)）。
