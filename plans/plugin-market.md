# 插件市场与版本（方案）

> 状态：**架构定稿，未实施**。所属平台见 [`plugins.md`](./plugins.md)，包格式见
> [`plugin-format.md`](./plugin-format.md)，内置资产的云同步见 [`relay.md`](./relay.md)。
>
> 市场有三件事，彼此独立，实施按依赖顺序推进：**市场清单**（有哪些插件）→ **插件包来源**
> （怎么拿到包）→ **版本检查与更新**（装了之后怎么知道有新版、怎么更新）。
> 本地目录型的市场与版本检查不需要任何网络与解包能力，先落地；url 市场与插件包拉取、解包
> 依赖网络底座与解包依赖，随后接入。

## 一、来源形式

| 来源 | 输入 | 由谁拉取 | 现状 |
| --- | --- | --- | --- |
| `directory` | `path`（本地目录） | 直接引用 | 先落地 |
| `url` | `url` + `headers?`，仅 `.zip` / `.tgz` | 自研（pi 不认 http tarball / zip） | 随后 |
| `npm` | `package`（`@scope/name@1.2.3`） | 复用 pi 的 `DefaultPackageManager` | 随后 |
| `github` | `repo` / `path?` / `ref?` | 复用 pi（走 git clone） | 随后 |
| `git` | `url` / `path?` / `ref?` | 复用 pi | 随后 |
| 市场内相对路径 | 字符串 | 自研（即本地目录） | 随市场清单 |

## 二、市场清单

- 清单文件 `marketplace.json`，三档识别规则与插件清单一致（当前品牌 → `.zcode-plugin` →
  `.claude-plugin`）。
- **本地市场**：指向一个目录，读取其中的 `marketplace.json`，条目里的相对路径相对该目录解析。
- **url 市场**：`marketplace.json` 直链；url 市场没有本地仓库，因此**其条目必须用显式来源**
  （`url` / `npm` / `github` / `git`），相对路径条目在校验阶段拒绝并出诊断。
- 清单形状（沿用 Claude 约定）：

```json
{
  "name": "my-market",
  "description": "…",
  "pluginRoot": "plugins",
  "plugins": [
    { "name": "hello", "source": "./hello", "version": "1.0.0", "category": "demo", "tags": ["…"] },
    { "name": "from-github", "source": { "source": "github", "repo": "owner/repo", "path": "p", "ref": "main" } }
  ]
}
```

- url 市场的拉取走公共网络底座（见第五节）：SSRF 准入 + 手动重定向 + 大小上限 + `ETag` /
  `Last-Modified` 条件请求；缓存到 `$APP_HOME/plugins/.marketplaces/<market>/marketplace.json`，
  记录 `sha256` / `fetchedAt` / `lastError`。刷新失败**保留上次缓存**并出诊断。

## 三、落盘与状态

```
$APP_HOME/plugins/                     # 插件根：用户手放的包 + 登记的本地目录
$APP_HOME/plugins/.marketplaces/<market>/   # 市场清单缓存（点开头，避免被当成插件包扫到）
$APP_HOME/plugins/.cache/<pluginId>/        # 需要复制的安装副本（directory 源不复制）
$APP_HOME/app/plugins.json             # 状态（0600）
$APP_HOME/app/plugins/data/<plugin>/   # ${*_PLUGIN_DATA}
```

`plugins.json`：

```json
{
  "marketplaces": [
    { "name": "my-market", "source": { "source": "directory", "path": "…" }, "lastRefreshAt": "…" }
  ],
  "installed": [
    {
      "id": "my-market/hello",
      "name": "hello",
      "version": "1.0.0",
      "source": { "source": "directory", "path": "…" },
      "path": "…",
      "scope": "user",
      "enabled": true,
      "integrity": "sha256:…",
      "installedAt": "…"
    }
  ],
  "config": { "my-market/hello": { "apiKey": "…" } },
  "capabilityGrants": { "my-market/hello": ["storage", "events"] },
  "trustedExtensions": ["my-market/hello"]
}
```

项目级 `<cwd>/.<slug>/plugins.json` 只承载启用覆盖 `{ "enabled": [...] }`，**默认不启用**。

## 四、插件包拉取（npm / git / github）

**复用 pi 的包管理器**：`DefaultPackageManager` 已公开导出（`@earendil-works/pi-coding-agent`
的 `dist/index.d.ts:17`），方法面覆盖 `install` / `remove` / `update` /
`checkForAvailableUpdates` / `listConfiguredPackages` / `getInstalledPath` / `setProgressCallback`，
落盘位置是 `<agentDir>/npm` 与 `<agentDir>/git/<host>/<path>`。它已经实现了源串解析、npm 的
peer 抑制与 pnpm / bun 适配、git 的 ref 固定——自研等价物等于重写 npm 与 git 客户端。

三条硬约束：

1. **声明不落盘**：`installAndPersist` 依赖文件型 settings，而会话装配用的是
   `SettingsManager.inMemory()`（`harness/setup/session-config.ts:261`）。插件来源身份存在**我们自己的**
   `plugins.json` 里，装配时以路径注入，不碰 pi 的 settings。
2. **子进程输出**：pi 的安装子进程用 `stdio: "inherit"`（`dist/core/package-manager.js:2141-2147`），
   在 server 里会绕过 pino 直接打到 stdout。**实施前先做一次 spike**：装一个真实 npm 包，看输出是否
   污染日志、是否卡住；不达标就把 npm / git 拉取改成 `execa` 自调（`npm install --prefix`、
   `git clone --depth 1 --branch <ref>`），pi 只留纯逻辑部分。
3. **环境要求**：机器上需要 `npm` 与 `git` 可执行文件；缺失时出诊断（`gitUnavailable` 一类已有先例），
   不让服务崩。

git 侧现状约束：`services/git` 的 `runGit` 只读取向（固定参数、10s 超时、16 MiB 缓冲，
`server/src/constants/tools.ts`），clone 需要单独的参数组合与超时；私有仓需系统 git 凭据预置
（`GIT_TERMINAL_PROMPT=0` 决定它直接失败），**我们不落任何明文凭证**。

## 五、url 源与解包

- **网络底座**：把 `harness/setup/tools/ssrf.ts` 的 `assertPublicUrl` 与 `webfetch.ts` 的手动重定向取流
  上提到 `server/src/platform/net/`（webfetch 反向引用），供路由层与市场复用，避免再写一套。
- **解包**：支持 `.zip` 与 `.tgz`。依赖选型 `fflate`（zip）+ `tar`（tgz），两者都是纯 JS、无原生编译，
  不用动 `pnpm-workspace.yaml` 的 `allowBuilds`。Node 内置 `node:zlib` 有 gzip / inflateRaw 但**没有
  tar 解析器**，tar 的 pax / longlink / symlink 处理属高风险解析器，不自己写。
- 新增依赖要同时改根 `package.json` 与 `server/package.json` 且版本一致
  （`scripts/verify/checks/manifest.ts:24-40`）。
- 解包后校验清单落在包根；组件路径仍走 `./` 前缀 + 根内校验。

## 六、版本检查与更新

按来源分类：

| 来源 | 版本判定 |
| --- | --- |
| `directory` | 目录内容哈希（无版本可比时给「已变更」标记；有清单 `version` 时优先比版本） |
| `github` / `git` | `git ls-remote` 比 ref 的 commit |
| `url` | 条件请求的 `ETag` / `Content-Length` / `Content-Digest` 比本地 `integrity` |
| `npm` | `checkForAvailableUpdates()`（自带 semver 与 pinned ref 规则） |

触发时机：

- `plugins/list` 只读缓存结果，**不打网络**（避免打开设置页就联网）。
- `marketplace/refresh` 刷新市场清单并顺带重算已装插件的可更新状态，结果落状态与缓存。
- 更新执行：`plugins/refresh` 重新拉取到目标版本，随后相关会话按启用集指纹重建。

## 七、安全与限额

| 项 | 规则 |
| --- | --- |
| 准入 | 只允许 `https`；复用 `assertPublicUrl`，**每一跳重定向重新准入**，跳数上限 5 |
| 体积 | 压缩体 ≤ 32 MiB、解包后总量 ≤ 128 MiB、条目数 ≤ 5000（防解压炸弹），超限报 `payloadTooLarge` |
| 路径穿越 | 拒绝绝对路径、`..` 段、超长路径；符号链接与硬链接解包时丢弃并记诊断 |
| 校验 | npm 走 npm 的 integrity；url 源记响应 sha256 进状态 |
| 私有源 | 不做凭据管理；私有仓需系统 git 凭据，失败出诊断，不落明文凭证 |
| 代理 | 现状 `fetch` 不读 `HTTP_PROXY`（Node 需显式配置）；作为已知边界写进 `docs/plugins.md`，要不要单独开一档另议 |
| 解包后 | 组件路径校验 + 清单必须在包根；可执行内容仍走逐插件信任 |

## 八、接口

- 域 `marketplace`：`list` / `create` / `delete` / `refresh`（动作都在 `docs/api.md` 的封闭词表内）。
- 插件侧：安装 = `plugins/create`（`source` 取一 / 六类之一），登记取消 = `plugins/delete`
  （只移除登记与状态，不删磁盘内容），启停与配置 = `plugins/update`，重拉 = `plugins/refresh`。
- 进度：长耗时的安装 / 解包把 pi 的 `setProgressCallback` 转成控制帧，设置页显示进度与失败原因，
  不做轮询。
- 契约：`PluginView` 增 `latestVersion?` / `updateAvailable` / `checkedAt?`；市场视图含
  `lastRefreshAt` / `refreshedOk`。

## 九、界面

设置页 Plugins 分页的「市场」区块：市场列表（添加 / 删除 / 刷新）、市场内插件（安装 / 更新 /
已装标记 / 版本对比）、诊断与进度。本地目录市场的表单最简单（一个路径输入 + 校验结果）。

## 十、实施顺序（按依赖）

1. **本地目录市场 + 版本检查**：`marketplace` 域、`plugins.json` 的 `marketplaces` 与
   `installed` 字段、directory 源安装 / 更新、市场区块 UI。不涉及网络与解包。
2. **url 市场**：公共网络底座上提 `lib/net`、条件请求与缓存、url 市场的条目来源校验。
3. **插件包拉取与解包**：pi 包管理器 spike（不达标改 `execa` 自调）、`fflate` + `tar`、六类来源、
   限额与穿越防护。

第 2、3 步之前，`PLUGIN_SOURCES` / 市场来源枚举与契约字段先按全量定义，未实现的来源在校验阶段
返回 `plugin_source_invalid` 并给出「该来源尚未支持」的明确诊断——不留静默失败。

## 十一、测试

- 市场清单解析：三档识别、相对路径条目在 url 市场被拒、来源形式逐类解析。
- 版本判定：目录内容哈希、semver 对比、ref commit 对比（用本地 git 仓库造夹具，不连外网）。
- 解包（第 3 步）：zip 与 tgz 各一例，含路径穿越、symlink、超限三类拒绝；夹具进 `__tests__/fixtures/`。
- 网络：SSRF 私网地址被拒；条件请求的缓存命中（mock 传输层，不真连）。
- 状态读写：`marketplaces` / `installed` / `capabilityGrants` / `trustedExtensions` 的增删改。
