# ucode

基于 [pi.dev](https://pi.dev)（Earendil Inc. 的 Pi agent harness，MIT）构建的分层智能体。

## 当前状态

**Web 壳与 TUI 壳已可用（实现步骤 0–5 落地）**；桌面壳与远程（uhub / 中继）尚未开始。

- 单仓多包：`packages/`（库）· `apps/`（cli | web | desktop | tui）· `hub/`（单独部署，可缺省）。
- 依赖严格单向（`apps/* → ui → sdk → bindings/* → protocol`；`core → store → data-layer-spec`），由**允许列表门禁**在 CI 拦截。
- 品牌参数化：产品名、数据层目录名等一律从 `@ucode/branding` 读取，源码里禁止出现字面量（同样有门禁）。
- 已落地：协议 C 的 Zod schema · 协议 D 的参考实现 + 一致性套件（18 例）· 核心层（握手 / 会话运行时 / 交互中转 / 工具闸门 / 工作区查询）· 四种绑定（stdio / rpc / http+SSE / ws）· headless SDK · CLI · TUI（Ink）· Web 壳（React + Tailwind）。
- 尚未落地：桌面壳、PTY 通道、非 owner 实例的文件跟随、无人值守的"释放等待态"、uhub。清单见[实现设计 §七](docs/impl/00-实现设计.md)。

```bash
pnpm install
pnpm check                                            # 类型检查 + Biome + 两道门禁 + 测试（77 例）
pnpm ucode provider add --base-url <端点> --model <模型> --api-key <密钥>   # 配一个模型（本地权威）
pnpm ucode web --port 3000                            # 浏览器打开 http://127.0.0.1:3000
pnpm ucode tui                                        # 终端里的壳（默认自己拉起核心层）
```

核心层也可以脱离控制层单独跑：`pnpm ucode core start --binding stdio|rpc|http|ws`。

**架构已完成技术验证并定稿**：`docs/spec/` 是 ucode 的**定稿需求与架构**（基线 tag `spec-baseline`）——骨架已确认，承重假设（V-1…V-10）已逐条验证（`V-5` 推翻、`V-8` 部分，处置见 [03](docs/spec/03-假设与验证.md)）。

需要坐实的**技术假设**集中登记在 [03 假设与验证](docs/spec/03-假设与验证.md)；**业务输入**（B-1…B-10）已确认，同样记录在那里。

## 从这里开始

| 你是 | 先读 |
|---|---|
| 要了解产品要做什么 | [00 需求与功能](docs/spec/00-需求与功能.md) |
| 要实现它的人 | [01 架构](docs/spec/01-架构.md) |
| 要追问某个设计为什么这么做 | [02 决策记录](docs/spec/02-决策记录.md) |
| 要跟进未定事项 | [03 假设与验证](docs/spec/03-假设与验证.md) |

## 文档结构

```
docs/spec/
  00-需求与功能.md    产品定位、核心场景、需求条目 R-n、功能清单 F-n
  01-架构.md          分层与协议、信任模型、数据层、核心层接口面、绑定层、远程与 uhub、包结构、技术选型、复用策略
  02-决策记录.md      ADR：决策 / 理由 / 被否方案 / 否掉的原因
  03-假设与验证.md    技术假设 V-n、已确认的业务输入 B-n、风险登记、唯一台账
docs/impl/
  00-实现设计.md      仓库与目录组织、包划分与职责、依赖图、调用与运行、构建测试、实现步骤
```

正文用 `【已决】/【实现级】` 内联标注：`【已决】` 是已确认的结论，`【实现级】` 是可自由替换的具体做法；验证记录汇总在 `03`。

## 一句话概括

一台机器上的数据层是**一个目录**（`~/.ucode`）。核心层是 headless 的智能体本体，只对外暴露一套与传输无关的接口面。绑定层把这套接口面序列化到 stdio / JSON-RPC / HTTP / WebSocket 上。控制层是这些协议的具象化，首发送代 **Web 壳与桌面壳**（共享 React 组件层），TUI 与移动端属后续。一台机器可以有多个核心层实例指向同一个数据层目录。远程能力由 AI SSH、远控、uhub 中继提供，三者都不改核心协议。

## 命名与品牌

上游默认：项目名 `ucode`，数据层路径 `~/.ucode`，中继服务 `uhub`（中文「枢纽」）。**产品名、数据层目录名、logo 属可配置的品牌配置（构建期注入）**，B 端定制 = 换一份品牌配置与资源、重新构建（见 [ADR-023](docs/spec/02-决策记录.md)）。

## 仓库位置

`/Users/lyy/code/project/ucode-work/ucode/`。
