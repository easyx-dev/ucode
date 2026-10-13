# `@ucode/ui` 的公开面：让 exports 表达「外壳能用什么」

> 来源：`docs/components.md` 的「公开面收口」后续项 + 目录重排后 `./business/*` 后缀与实际内容不符（本轮审查 #4）。
> 状态：**已落地**（方案 C′）。实际改动：删根入口 `.`（`types` 改指 `src/types.ts`）、新增
> `scripts/verify/checks/ui-exports.ts` 并在 `pnpm verify` 注册、边界写进 `docs/components.md`/
> `AGENTS.md`、`CHANGELOG.md` 记一条。判据与域结构见 [`docs/components.md`](../docs/components.md)，
> 搬迁记录见 [`plans/ui-structure.md`](./ui-structure.md)。

## 一、现状（实测）

`packages/ui/package.json` 的 exports：

```json
{
  ".": "./src/index.ts",
  "./base/*": "./src/base/*.tsx",
  "./business/*": "./src/business/*.tsx",
  "./hooks/*": "./src/hooks/*.ts",
  "./utils/*": "./src/utils/*.ts",
  "./provider": "./src/provider/index.tsx",
  "./presets/workspace": "./src/presets/workspace/workspace-layout.tsx",
  "./theme.css": "./src/styles/theme.css"
}
```

各通配与目录实际内容（重排后）：

| 通配 | 目标后缀 | 目录实际情况 | 是否一致 |
| --- | --- | --- | --- |
| `./base/*` | `.tsx` | 24 个文件，全是 `.tsx` | 一致 |
| `./business/*` | `.tsx` | 128 个 `.tsx` + 103 个 `.ts`（其中 33 个是用例） | **不一致** |
| `./hooks/*` | `.ts` | 顶层 10 个 `.ts` + `store/` 13 个 `.ts` | 一致 |
| `./utils/*` | `.ts` | 14 个 `.ts` | 一致 |

外壳（`apps/web`、`apps/desktop`）真实用到的子路径只有 10 条（另有 CSS 的 `@ucode/ui/theme.css`）：

```
@ucode/ui/provider                       （3 处）
@ucode/ui/presets/workspace              （2 处）
@ucode/ui/base/button                    （1 处）
@ucode/ui/business/shell/login-page      （1 处）
@ucode/ui/business/shell/theme-provider  （2 处）
@ucode/ui/hooks/use-auth                 （2 处）
@ucode/ui/hooks/use-error-text           （1 处）
@ucode/ui/hooks/store/use-sessions       （2 处）
@ucode/ui/utils/app-i18n                 （2 处）
@ucode/ui/utils/settings-section         （2 处）
```

包内自己的引用一律是相对路径，不经过 exports。`business/notify/notice` / `business/notify/sound`
只出现在桌面的**注释**里（说明提示音与通知桥在那两个文件里），不是 import。

## 二、问题

1. **`./business/*` 的后缀与实际内容不符**：它写死 `.tsx`，而 `business/**` 下有约 70 个非用例的 `.ts`
   （域内逻辑与私有 hook、`dialog/queue.ts` 这类带模块级状态的、`notify/notice.ts` 这类带设备 IO 的）。
   今天没有外部消费者，所以没暴露，但这条通配已经在传达一个不成立的事实。
2. **失败模式是「响的」，但发现得晚**：外壳真去引 `@ucode/ui/business/chat/message/chat-nodes` 时，
   TS（moduleResolution bundler）会解析成 `.../chat-nodes.tsx` 找不到而报「Cannot find module」，
   Vite 也会在 transform 期报「Failed to resolve import」——不会静默跑错，所以这不是线上风险；
   代价是**等到有人真要复用域内逻辑时才发现公开面表达不了它**。
3. **另外三条通配今天是准的，但没有任何东西拦住它漂移**：`base/` 里加一个 `.ts`（比如常量表）、
   `hooks/` 里加一个 `.tsx`（比如带 Provider 的 hook），就会重演同一个坑。
4. **公开面没有表达「外壳应该用什么」**：`./business/*` 通配把整个业务域都算作公开面，
   而实际被外壳用到的只有 `business/shell/` 的两个入口。

## 三、要接受的边界（本计划的核心判断）

`packages/ui` 的设计意图是**组合式**：`docs/components.md` 写着「应用层拼装 `base/*` 与 `business/*`；
`presets/workspace` 只是一套默认组合，任何应用都可拆开自拼」，预设自己的文件头注释也这么写。
所以不能把 `./business/*` 收成「只有 shell 两个入口」——那会削掉已写进文档的能力。

于是边界定为：

- **`./business/*` 暴露的是「业务组件」（`.tsx`）**：外壳可以拿 `chat/chat-panel`、`session/session-sidebar`
  这类组件自己拼一套布局；
- **域内的逻辑与 hook（`.ts`）是内部实现**：外壳要复用的能力应该先在包里上提到 `hooks/*`（React 绑定）
  或 `utils/*`（无 React 的通用方法），而不是直接深链某个域的实现——真需要时按第五节的两条备选处理；
- **`base/*` / `hooks/*` / `utils/*` 是设计好的公共层**，保留通配（每加一个原语 / 绑定 / 工具都要改 exports
  反而会挡住正常的组合），但要校验后缀仍与目录一致。

## 四、方案

**推荐：C′（定边界 + 轻校验），并把「收口」限定在无效面上**——不动 `business/*` 的现有能力，
删掉没人用的根入口，加一条校验防止后缀漂移。

具体四件事：

1. **删掉根入口 `.`（`src/index.ts`）**：全仓没有一处 `from "@ucode/ui"`（它只是 `types` 字段的落点），
   而它导出的 `ErrorToaster` / `UiProvider` / `useStore` 都能从 `business/shell/error-toaster`、
   `provider`、`hooks/use-store` 取到。删除后把 `types` 字段指向 `src/types.ts`（契约与 SDK 类型的门面）。
   公开面因此只剩「三层通配 + 具名入口 + CSS」，没有歧义。
2. **把第三节的边界写进文档**：`docs/components.md` 的「分层」或「组合优先」段补一句
   （`business/*` 对外的是组件；域内 `.ts` 属内部实现，需要就把能力上提），并在 `AGENTS.md`
   的 packages/ui 段落带一句。`package.json` 不能写注释，所以边界只能落在文档与校验上。
3. **新增 `scripts/verify/checks/ui-exports.ts`**（`pnpm verify` 的 ui-exports 项）：
   - ① **每条 exports 的目标必须存在**——防「改名后忘了同步 exports」的死条目（根入口就是长期潜伏的例子）；
   - ② **通配后缀与该目录实际内容一致**：`base/*` 全 `.tsx`、`hooks/*` 全 `.ts`、`utils/*` 全 `.ts`；
     `business/*` 单独一条规则：允许同时有 `.tsx` 与 `.ts`，但**若目录里出现 `.tsx` 之外的公开意图文件**
     （例如新目录只有 `.ts`）要提示——具体形式实现时定，宁可少报不要误报；
   - ③ **外壳引用可解析**：扫 `apps/**` 的 `from "@ucode/ui/…"`，每条都必须能被 exports 解析到存在的文件
     （今天 10 条全过；这条同时挡住将来手写的、引不到的深链）。
4. **验证方式**：`pnpm check`（含新校验）+ `pnpm -r typecheck` + `pnpm build`；另做一次**反向验证**——
   临时在 `apps/web` 写一行 `import "@ucode/ui/business/chat/message/chat-nodes"`，确认报错、再删掉
   （这一步只在本地方便时做，不进提交）。

**备选（先不做，记在这里备用）**：

- **A · 真要把某个域的 `.ts` 暴露出去**：优先把它**上提到 `hooks/*` 或 `utils/*`**（说明它本来就不该只属于一个域）；
  若它确实属于某个域、又确实要给外壳用，再给它加一条具名 exports。
- **B · 让带扩展名的通配成立**：加 `"./business/*.tsx"` 与 `"./business/*.ts"` 两条，调用方写扩展名
  （`@ucode/ui/business/chat/message/chat-nodes.ts`）。能表达「两种扩展名」，但与仓库「导入不带扩展名」的写法冲突，
  除非 A 不够用，否则不引入。

**为什么不选「把 `business/*` 收成 10 条具名入口」**：与第三节的设计意图冲突——外壳要自拼布局时
（文档明确支持）会立刻缺条目，等于把「组合式」变成「只能按预设用」。

## 五、改动清单（预估）

| 文件 | 改动 |
| --- | --- |
| `packages/ui/package.json` | 删 `"."`；`types` 指向 `./src/types.ts`；其余条目不动（`./presets/workspace` 保持现目标） |
| `packages/ui/src/index.ts` | 删除（若担心外部有未知消费者，可先只改文档与校验，删根入口单独一步做） |
| `scripts/verify/checks/ui-exports.ts` | 新增，按第四节 ①②③ |
| `scripts/verify/index.ts` | 注册 `ui-exports` 项 |
| `docs/components.md` | 「公开面」段：三层通配 + 具名入口 + `business/*` 只对外组件 |
| `AGENTS.md` | packages/ui 段落补一句公开面边界 |
| `CHANGELOG.md` | 记一条「删根入口 / 公开面收口」（涉及使用方，按约定要记） |
| `plans/ui-structure.md` | 「后续」里的「公开面收口」改为指向本文件 |

## 六、验收

- `pnpm check` 通过（含新增的 ui-exports 校验）；`pnpm -r typecheck`、`pnpm build` 通过；
- 外壳无需改动（现有 10 条子路径与 CSS 引用都不变）；
- 反向验证：深链一个域内 `.ts` 会在编译期报错（证明公开面边界成立）；
- 校验能被触发：临时造三类故障，ui-exports 均能报出并且位置准确 ——
  ① `base/` 里混进一个 `.ts`；② 把一条 exports 目标改成不存在的路径；
  ③ 外壳写一行 `import "@ucode/ui/business/chat/message/chat-nodes"`（域内 `.ts`）与一条未声明的子路径。
  三者验完均已恢复，`pnpm verify` 回到 15 项全绿。

## 七、不做

- 不改 `business/*` 的能力（见第三节）；
- 不引入路径别名、不改包内相对引用风格；
- 不动 `apps/*`（除反向验证时临时那一行，验完即删）。
