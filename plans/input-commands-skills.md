# 输入区与命令 / 技能 / 附件（整合方案）

> 本文整合并取代仓库内的 `plans/composer.md`（输入区富文本 + 命令快捷输入），并纳入资源发现、
> 内置命令、自定义 primary agent、技能权限等 P0 决策。
> 底层复用 pi SDK 的 Skills / Prompt Templates / `DefaultResourceLoader`，不重写；
> 前端输入区按 Tiptap 方案实施。
> 状态：**已完成**：内置命令、自定义提示词命令与技能、附件上传都已落地，逐项变化见 `CHANGELOG.md`。

## 一、目标与范围

**目标**：把输入区从纯 `<textarea>` 换成轻量富文本编辑器，并打通「命令 / 技能」资源的发现与调用：

- **`@` 添加上下文**：从会话工作目录检索文件/文件夹，选中后把内容内联进本轮。
- **`/` 选择命令或技能或内置动作**：一个菜单同时列出提示词模板（pi `PromptTemplate`）、技能（pi `Skill`）
  与内置命令（前端动作）；命令/技能插入后命令占首位，技能序列化为 pi 认的 `/skill:name`。
- **图片粘贴**：剪贴板/拖拽图片进附件区，随 prompt 发给模型。
- **资源发现**：全局 + 项目级 + `.agents` 兼容三处放置命令与技能，按优先级合并并新增列举接口。
- **自定义 primary agent**：允许用 Markdown 定义主会话 agent，并可覆盖内置 `build` / `plan` / `ask`。

**做**：

- 编辑器内核用 Tiptap（ProseMirror），但**只装结构节点与 mention/suggestion**，不装任何排版 marks。
- 命令与技能目录：全局 `$APP_HOME/{prompts,skills}`、项目 `<cwd>/.ucode/{prompts,skills}`、
  兼容 `<cwd>/.agents/skills` 与 `~/.agents/skills`；新增列举接口；技能清单由 pi 注入系统提示词。
- 附件：前端附件区 + 服务端归一化 + 内容寻址附件库 + 字节路由渲染（见决策 6）。
  图片走原生 vision；非图片（PDF/Word/Excel）本期只做**存储与引用**，解析留作插件 / MCP（见 §四.5）。
- 草稿：编辑器 JSON + 附件 blob（IndexedDB）持久化。
- 自定义 primary agent：`<cwd>/.ucode/agents/*.md` 与全局 `$APP_HOME/agents/*.md`（详见 §八）。

**明确不做**（留后续）：

- 排版能力（加粗、斜体、标题、列表、字号、颜色、背景等）——本次明确不要。
- 底栏选择器的改造（模型/档位/模式仍然保留原样）。
- 项目内**嵌套目录**的层级资产发现（子包里各自 `.ucode` 的镜像发现）——只做 cwd 向项目根的**祖先发现**，不做向下 / 平级递归（见决策 17）。
- 上下文类型扩展（终端输出、历史会话、git diff、浏览器）——先做文件/文件夹。
- 非图片附件（PDF/Word/Excel）的解析——本期只留口子，后续以插件 / MCP 接入（见 §四.5）。

## 二、已锁定决策

1. **编辑器内核用 Tiptap**，最小扩展集：`Document / Paragraph / Text / HardBreak / Mention / Suggestion / Placeholder`。
   不装 `StarterKit`（会带一排 marks），不装 `@tiptap/extension-image` / `@tiptap/markdown`。
2. **没有富文本排版**：编辑器只有纯文本、换行、原子 chip；不出现字体/字号/颜色/背景/加粗斜体。
3. **附件放编辑器上方的独立 attachment 行**，不内联进正文（对齐 opencode）。
4. **`/` 是唯一的命令入口，内置动作 / 命令 / 技能同菜单、分三组**：
   - 内置动作（`/new`、`/sessions`、`/compact` …）→ **前端立即执行的 UI 行为**，不序列化进正文，不允许出现在文档中间。
   - 提示词命令 → 序列化为 `/name`；技能 → 序列化为 `/skill:name`。
   pi 的展开要求整条文本匹配 `/name args` 或 `/skill:name args`（`expandPromptTemplate` 正则 `^\/…$`、
   `_expandSkillCommand` 要求 `startsWith("/skill:")`），所以**命令与技能只在文档开头生效**；
   选中后命令占首位、后面是参数。不引入 `$` 前缀（业内 Claude Code / Cursor / Codex 都把技能并进 `/` 菜单）。
5. **`@` 内联任意位置**：发送时从正文剥离路径到 `contexts[]`，服务端读内容并用不可信边界 `<context>` 前置。
6. **附件：内容寻址附件库（图片与非图片统一存储）**。图片经 pi `resizeImage` 归一化（2000×2000、base64 5MB）
   后按 `sha256` 落到 `$APP_HOME/app/attachments/` 并发给模型做原生 vision；非图片原样入库、只做引用
   （解析见决策 12）。`MessageBlock` 以 `{ id, mimeType, url }` 引用，前端按 `url` 懒加载；不内联 base64——
   那更适合本地单机 server，本仓库要支持局域网/远程与多端看同一会话。
7. **草稿只在本端**：草稿（文本 / 上下文 / 命令 + 附件 blob）走 localStorage + IndexedDB，
   不做跨端同步；只有**发出去的历史**才由服务端持有、多端可见。
8. **命令与技能目录**：全局 `$APP_HOME/{prompts,skills}`（顶层，**不用** pi 默认的 `agentDir/skills`）、
   项目 `<cwd>/.ucode/{prompts,skills}`（`.<brand.slug>`）；兼容 `.agents/skills`（仅 skills，见 §三）。
   会话装配禁用 pi 默认目录，只认这些目录。
9. **不新增 web 以外的运行时依赖**：图片归一化复用 pi 已导出的 `resizeImage`（内置 Photon wasm）。
10. **技能默认允许模型自动调用**：技能清单由 **pi 自动注入**系统提示词（`AgentSession` 从
    `resourceLoader.getSkills()` 取值，`disable-model-invocation` 自动排除），**ucode 不手动 `formatSkillsForPrompt`**；
    同时保留 `/skill:name` 显式调用，对齐 Claude Code / Cursor 的「自动 + 显式」双通道。
11. **附件增强**（对齐 Cursor / Copilot / opencode）：`@` 支持文件与文件夹、可带行/选区范围；
    粘贴大段文本可一键转成附件；命令带 `argument-hint` 前端提示；附件以可删 chip 呈现。
12. **非图片附件只留口子**：本期不引入任何文档解析依赖。附件库、`MessageBlock` 预留的 `file` 变体、
    消息里的附件引用标记、以及保留的自研工具名 `read_attachment` 共同构成集成点；
    PDF/Word/Excel → 文本的解析作为后续插件 / MCP 接入（参考 opencode 的 `opencode-parser` 做法）。
13. **项目资源直接生效，不过 project trust**（ucode 用自己的信任模型；本期无审批）。
14. **同名优先级**由我们显式排出后交给 pi（pi 是 first-wins），见 §三。
15. **SDK 往前提**：对外 OpenAPI + `@ucode/client` 纳入 P3（见 §十四）。
16. **自定义 primary agent 允许覆盖内置 `build` / `plan` / `ask`**（见 §八）。
17. **项目级资产做祖先发现**：skills / prompts 从 cwd 逐级向上到项目根（无 git 根则停在 `$HOME` 或文件系统根），近者优先；
    不做向下 / 平级的嵌套发现。优先级表内「项目」级 = 项目各级目录按近→远（见 §三）。
18. **`mode` 契约放宽为 slug 字符串**，服务端按 agent 注册表校验（内置三 + 自定义 primary）；
    `SESSION_MODES` 保留为「内置默认集合」，`DEFAULT_SESSION_MODE` 不变（见 §八）。
19. **内置命令集合敲定为 12 个**（见 §九）。

## 三、资源发现与同名优先级

优先级（数字小 = 高；同名时高级别生效，低级别记 `collision` 诊断）：

**Skills**

| 级别 | 来源 | 说明 |
|---|---|---|
| 1 | 项目 `.ucode/skills`（cwd → 项目根，近→远） | 产品原生、项目级 |
| 2 | 项目 `.agents/skills`（cwd → 项目根，近→远） | 兼容生态、项目级 |
| 3 | 全局 `$APP_HOME/skills` | 产品原生、用户级 |
| 4 | 用户 `~/.agents/skills` | 兼容生态、用户级 |

**命令（prompts）** — `.agents` 不适用：

| 级别 | 来源 |
|---|---|
| 1 | 项目 `.ucode/prompts`（cwd → 项目根，近→远） |
| 2 | 全局 `$APP_HOME/prompts` |

原则：**项目 > 用户；`.ucode` 原生 > `.agents` 兼容**。

实现约束：

- pi 的 `loadSkills` / `dedupePrompts` 都是 **first-wins**（先加载者胜，后者仅告警），因此路径数组必须按上表顺序传入。
- `DefaultResourceLoader` 里 `additionalXxxPaths` 排在最后 = 优先级最低；用 `noSkills: true` /
  `noPromptTemplates: true` 关掉 pi 默认目录后，路径顺序 = 我们传入的顺序，可控。
- 同一份列表要同时供「广告给模型」与「`/skill:name`、`/name` 展开」使用；如需更强控制用
  `skillsOverride` / `promptsOverride` 自行合并。
- 坏文件按 pi 规则：缺 `description` 不加载、`SKILL.md` 解析失败跳过并记诊断，不影响其它资源。
- 项目级做**祖先发现**：从 cwd 逐级向上到项目根（git 根；无则停在 `$HOME` 或文件系统根），近者优先。
  只做向上发现，不做向下 / 平级的嵌套发现（对齐 composer 范围，但补上祖先链）。
- 与 `cwd` 同级 / 向上每一级的 `.ucode/skills`、`.agents/skills`、`.ucode/prompts` 都参与，
  按上表级别归位；同一级别内近的目录优先。

## 四、输入区设计（前端核心）

### 4.1 文档模型

Tiptap 文档只含段落、文本、硬换行与两个原子 mention 节点：

| 触发 | 节点 | attrs | 序列化到正文 | 说明 |
| --- | --- | --- | --- | --- |
| `@` | `contextMention` | `path`、可选 `startLine`/`endLine` | 无（进 `contexts[]`） | 可内联在任意位置 |
| `/` | `commandMention` | `kind`(`prompt` \| `skill`)、`name` | `/name` 或 `/skill:name` | 仅文档开头 |

两个节点由 `Mention.extend({ name })` 派生（或直接用 `@tiptap/suggestion` 自建节点），各自绑定
`char`、下拉数据源与 `allow`。`/` 的 `allow` 限定 `range.from === 1`；同一个提示菜单内分三组展示
**内置动作 / 命令 / 技能**。内置动作选中后**不产生节点**，直接触发前端 action（见 §九）。

### 4.2 发送载荷

`lib/composer-document.ts` 提供 `docToPayload(editor)`：

```ts
type ContextRef = { path: string; startLine?: number; endLine?: number };

type ComposerPayload = {
  text: string;              // 正文（命令/技能已还原为 /name、/skill:name）
  contexts: ContextRef[];    // @ 引用（绝对路径，限会话 cwd 内；可选行范围）
  images: MessageImage[];    // { data: base64, mimeType }
};
```

- 段落 → 文本，`hardBreak` → `\n`，`paragraph` 之间补 `\n`。
- `contextMention` 不进 text（服务端前置内容），只收集 `ContextRef`。
- 空正文 + 只有图片也允许发送（`text` 可为空串，服务端据此放行——见契约的校验调整）。

### 4.3 草稿与附件

- `lib/composer-draft.ts`：草稿在原有 `text` 基础上增 `parts: ComposerPart[]` 与 `attachments: string[]`（blob id）。
  读取时若只有旧 `text`，按单个 text part 处理（本地草稿，不做迁移脚本）。
- `lib/draft-store.ts`：原生 IndexedDB（库名 `` `${brand.slug}-drafts` ``，store `blobs`），
  `putBlob(blob) -> id`（SHA-256 hex）、`getBlob(id)`、`objectUrl(id)`（缓存 `URL.createObjectURL`）。
- 粘贴/拖拽图片：客户端先用 canvas 预压缩（最长边 2000px、目标 ≤ 5MB）再入 store；历史 blob 无引用时按需清理。
- 粘贴大段文本（阈值对齐 opencode：≥ 8000 字符或 ≥ 120 行）：提示可一键转成附件，不直接灌进正文。

### 4.4 组件

`apps/web/src/components/composer/`：

- `editor.tsx`：Tiptap 实例、扩展装配、内容回写、Enter 发送 / Shift+Enter 换行、IME、Placeholder。
- `suggestion-list.tsx`：`@` / `/` 共用的下拉（键盘导航，锚定光标 `getBoundingClientRect()`）。
- `context-suggestion.ts` / `command-suggestion.ts`：两个触发器的数据与行为；命令下拉分三组。
- `text-attachment.ts`：粘贴大段文本转附件的判定与渲染。
- `attachment-strip.tsx`：编辑器上方的附件行——图片显示缩略图（可点开预览），非图片显示可下载的文件 chip。
- `use-composer-images.ts`：粘贴/拖拽 → store → 附件状态。

### 4.5 附件扩展口子（非图片，本期只留口）

非图片附件（PDF / Word / Excel 等）本期**不解析**，只保证后续插件 / MCP 能无痛接入：

- **存储统一**：与图片共用内容寻址附件库，按 `sha256` 存**原始字节** + `mimeType` + 原始文件名。
- **渲染预留**：`MessageBlock` 预留 `file` 变体 `{ type:"file"; id; mimeType; name; size; url }`；
  附件行把非图片显示成可下载的文件 chip（无预览）。本期该变体不产生，先占位，避免以后改响应形状。
- **给模型的引用**：消息里带一行附件清单（`[附件: report.pdf (id: <hash>)]`），让模型知道有它。
  本期模型拿不到正文——pi 的内容模型只有 `text | image`，吃不了文档。
- **解析入口（保留）**：保留自研工具名 **`read_attachment`**：
  `read_attachment(id, { pageRange?, sheetName?, maxChars? }) -> text`；实现时按需解析并缓存结果，
  也可直接做成 MCP server 接入（`build` 模式已支持 MCP）。
- **依赖**：本期不引入任何解析库；`officeparser`（单库覆盖 pdf/docx/xlsx/pptx/odt/…）或
  `unpdf` + `mammoth` + `exceljs` 三件套，都在后续插件里再定。

### 4.6 `@` 上下文的数据流

以 `@src/a.ts:10-40` 为例，看形状怎么变——**第 4 步从结构化引用被压成一段文本**（pi 的内容模型只有
`text | image`，没有文件 part）：

1. **编辑器（Tiptap doc JSON）**：原子 `contextMention` 节点，`attrs.path` 存绝对路径、可选行范围；
   界面显示相对 cwd 的 label。
   ```json
   { "type": "contextMention", "attrs": { "path": "/proj/src/a.ts", "startLine": 10, "endLine": 40 } }
   ```
2. **客户端载荷**（`docToPayload`）：mention 从正文剥离、单独成数组，正文留下空格。
   ```ts
   { text: "看看  的问题", contexts: [{ path: "/proj/src/a.ts", startLine: 10, endLine: 40 }], images: [] }
   ```
3. **HTTP** `POST /messages/prompt`：`{ sessionId, text, contexts, behavior }`。
4. **服务端 `expandContexts`（质变点）**：校验路径在 cwd 内 → 读文件 / 按行范围切片 → 截断 →
   不可信包裹（正文里的 `</context>` 中和）→ 前置拼进正文，再 `session.prompt(finalText, { images })`：
   ```
   <context path="src/a.ts" lines="10-40">
   …文件内容…
   </context>

   看看  的问题
   ```
5. **pi / JSONL**：只落一条**文本**用户消息，没有「这是引用文件」的结构化痕迹；模型侧也只见文本。
6. **历史回放**：`MessageDTO` 的 text block 含 `<context>` 块，前端从前缀解析回 chip，其余按原文显示。

**后果**（都是「扁平化」的代价）：

- 上下文**位置丢失**：所有 context 前置，chip 在句子中间的位置信息不再保留。
- 历史传输与存储变重（用户消息里含完整文件内容）。
- **「编辑并重发」退化成展示展开后的文件内容**（见 §十二）。
- token 预算靠 `CONTEXT_MAX_*` + 截断兜。

**更干净的历史 / 编辑形态**（本期不做）：sidecar 存 `entryId → ContextRef[]` 与原始文本，或等 pi 支持 file part。

## 五、契约（packages/contracts）

- `constants.ts`：
  - `IMAGE_MIME_TYPES = ["image/png","image/jpeg","image/webp","image/gif"]`、`type ImageMimeType`。
  - `PROMPT_MAX_IMAGES`、`PROMPT_MAX_CONTEXTS`、`MESSAGE_IMAGE_MAX_BASE64_BYTES`。
  - `COMMAND_ASSET_SOURCES = ["project","agents-project","global","agents-user"]`、`type CommandAssetSource`
    （数组顺序即优先级，供前端分组；prompts 只会取到 `project` / `global`）。
- `messages/input.ts`：
  - 新增 `messageImageSchema = { data: base64(1..上限), mimeType: IMAGE_MIME_TYPES }`。
  - 新增 `contextRefSchema = { path: string; startLine?: int; endLine?: int }`。
  - `promptInputSchema` 增 `contexts: ContextRef[] (≤ PROMPT_MAX_CONTEXTS).optional()`、
    `images: MessageImage[] (≤ PROMPT_MAX_IMAGES).optional()`；
    `text` 放宽为可空串（有 `contexts` 或 `images` 时允许无正文，路由层再校验「三者至少一项」）。
  - 导出 `MessageImage` / `MessageImageRequest` / `ContextRef`。
- `messages/output.ts`：`MessageBlock` 增 `{ type: "image"; id: string; mimeType: string; url: string }`；
  同期**预留** `{ type: "file"; id: string; mimeType: string; name: string; size: number; url: string }`
  （本期不产生，见 §四.5）。
- 新增附件**字节路由**（非 JSON 例外，同 `/events`，不走封套、用 GET）：
  `GET {API_BASE_PATH}/attachments/<id>` 按 `id`（sha256）返回字节 + `Content-Type` /
  `Cache-Control: immutable` / `ETag`；与类型无关（图片/文档同一路由）；无 zod 契约，在 `docs/api.md` 的例外处登记。
- 新域 `commands/{input,output}.ts`：
  - `commandsListInputSchema = { sessionId?: string; cwd?: string }`（优先 `sessionId` 解析 cwd）。
  - `PromptCommandView = { name; description; argumentHint?; source: CommandAssetSource }`
  - `SkillCommandView = { name; description; source: CommandAssetSource }`
  - `CommandsListResponse = { prompts: PromptCommandView[]; skills: SkillCommandView[] }`（双集合，
    按「详情」形态返回，不带 `total`）
- 新域 `agents/{input,output}.ts`（供 agent 选择器与自定义 primary）：
  - `agentsListInputSchema = { sessionId?: string; cwd?: string }`。
  - `AgentView = { slug; label; description; kind: "primary" | "subagent"; source: "builtin" | "project" | "global"; hidden?: boolean }`
  - `AgentsListResponse = { primary: AgentView[]; subagents: AgentView[] }`
  - 前端 `modeLabel` / `modeDescription` 对自定义 slug 回落到 `label` / `description`。
- 会话契约放宽（见 §八）：`SESSION_MODES` 改为「内置默认集合」（命名可保留，加注释说明不再穷举），
  `sessions/create|update` 的 `mode` 改为 `z.string().regex(slug)`，服务端按注册表校验；
  `SessionSummary.mode` 类型改为 `string`。
- `fs/`：新增 `fsSearchInputSchema = { path?: string; q?: string; limit? }`（默认/上限按 `docs/api.md` 的 `limit` 约定）、
  `FsSearchResponse = { path: string; entries: FsEntry[]; truncated: boolean }`。
  `search` 是 `docs/api.md` 动作词表外的**新动词**，需在该表登记；或改用 `list` + 递归/查询参数，避免扩张词表。
- `envelope.ts`：新增 `imageInvalid: "image_invalid"`。
- `index.ts`：导出新域。
- `packages/i18n/src/error-messages.ts` + `locales/domain/{zh-CN,en}.ts`：补 `image_invalid` 映射与文案。

## 六、server

- `constants.ts`：`SKILLS_DIRNAME`、`PROMPTS_DIRNAME`、`PROJECT_CONFIG_DIRNAME`（`.${brand.slug}`）、
  `AGENTS_COMPAT_DIRNAME`（`.agents`）、`ATTACHMENTS_DIRNAME`、`CUSTOM_AGENT_MAX_BYTES`、
  `CONTEXT_MAX_FILES`、`CONTEXT_MAX_FILE_BYTES`、`CONTEXT_MAX_TOTAL_BYTES`、
  `FS_SEARCH_MAX_ENTRIES`、`FS_SEARCH_SKIP_DIRS`、`IMAGE_MAX_DIMENSION`、`IMAGE_MAX_BASE64_BYTES`。
- 新 `agent/assets/`：
  - `paths.ts`：`commandAssetPaths({ cwd, appHome })` → 按 §三 优先级产出**有序**的
    `{ skillPaths, promptPaths }`（去重、只含存在目录）。
  - `index.ts`：`loadCommandAssets({ cwd, appHome })` → 用 pi 已导出的 **`DefaultResourceLoader`**
    （传 `noSkills` / `noPromptTemplates` + 有序 `additionalSkillPaths` / `additionalPromptTemplatePaths`，
    `reload()` 后读 `getPrompts()` / `getSkills()`）返回 `{ prompts, skills }`，映射为**不含绝对路径**的视图
    （`name` / `description` / `argumentHint` / `source`）。
    注意：`loadPromptTemplates` **不是** pi 包根导出（根导出只有 `loadSkills` 与 `PromptTemplate` 类型），
    不可直接 `import`。
- `agent/session-config.ts`：`createSessionLoader` 传 `noSkills: true` / `noPromptTemplates: true` +
  来自 `commandAssetPaths` 的有序路径，使 pi 的 `/name`、`/skill:name` 展开只认这些目录、不读 `cwd/.pi/`。
  **不**手动拼技能清单——pi 的 `AgentSession` 会自动从 `resourceLoader.getSkills()` 注入系统提示词。
- 新 `agent/context/`：`expandContexts(cwd, refs)`（`refs: ContextRef[]`）：
  - 逐路径归一化并限定在 `cwd` 内（越界 → `invalid_request`，不存在 → `path_not_found`）。
  - 文件 → 读内容（带 `startLine`/`endLine` 时只取该区间）；目录 → 递归清单（受 `FS_SEARCH_SKIP_DIRS`、条数上限约束）。
  - 单文件 / 总字节超限 → 截断并附注（`truncated` 文案）。
  - 用 `<context path="…">` 包裹；`agent/tools/untrusted.ts` 的 `UNTRUSTED_TAGS` 增 `context`，
    `neutralizeTags` 一并中和，防止正文伪造边界。
- 新 `agent/attachment/`：通用附件库层——`putAttachment(bytes, mimeType) -> { id, path }`（`sha256` 内容寻址，
  落 `$APP_HOME/app/attachments/`，存在即跳过）、`resolveAttachment(id) -> path | null`（校验 64 位 hex）。
  图片与非图片共用；本期只有图片会写入。
- 新 `agent/image/`：`normalizeImages(images)`：逐张 `Buffer.from(data,"base64")` →
  `resizeImage(bytes, mimeType, { maxWidth, maxHeight, maxBytes })`；无法归一化（`null`）→ `image_invalid`。
  归一化结果经 `agent/attachment` 入库，返回 `{ id, mimeType }`；DTO 的 `url` 由 `id` 拼出。
- `core/run.ts`：`admitPrompt` 展开 contexts（内容前置到 text）并归一化 images；
  三者（text/contexts/images）全空 → `invalid_request`。
- `core/pool.ts`：`startRun(sessionId, session, text, images?)` → `session.prompt(text, { images })`；
  排队分支 → `session.steer(text, images)` / `session.followUp(text, images)`。
  pi 的 `ImageContent` 未从包根导出，且仓库约定不直接依赖 `@earendil-works/pi-ai`（见 `core/runtime.ts`）；
  `agent/image` 产出结构兼容对象 `{ type:"image", data, mimeType }`，类型从 `prompt` 的方法签名取
  （对齐 `runtime.ts` 的做法）。
- `core/serialize.ts`：`blocksOf` 的 `image` 分支由文字 `[图片]` 改为 `{ type:"image", id, mimeType, url }`
  （`id = sha256(base64)`，`url = ${API_BASE_PATH}/attachments/<id>`）。
- **权限（技能读取）**：pi 的 skill 走「模型用 `read` 读 `SKILL.md`」；需让权限引擎把「读 skill 文件」
  识别为 skill 授权，否则只读模式（plan / ask / explore）会因 skill 文件路径被 `external_directory` 拦。
  项目资源直接生效，不引入 trust 提示。
- 新 `routes/commands/index.ts`：`POST /commands/list`（按 `sessionId` 解析 cwd，缺省 `env.workspaceRoot`）。
- `routes/fs/index.ts`：新增 `POST /fs/search`（受限 walker，`FS_SEARCH_SKIP_DIRS` + 基础 `.gitignore` 可选）。
- 新 `routes/attachments/index.ts`：`GET /attachments/:id` —— 非 JSON，直接返回字节；校验 `id` 为 64 位 hex，
  只读附件库目录（防路径穿越），带 `Content-Type` / `Cache-Control: immutable` / `ETag`，缺失 404。
- `/compact` 手动压缩接口（内置命令 `/compact` 的服务端支撑，见 §九）。
- `index.ts`：挂 `/commands` 与 `/attachments`；`app.ts` 无需改（`commands` 只读、直接取 `services.sessions`）。

## 七、前端

- 依赖（`apps/web/package.json`）：`@tiptap/react`、`@tiptap/core`、`@tiptap/pm`、
  `@tiptap/extension-document`、`@tiptap/extension-paragraph`、`@tiptap/extension-text`、
  `@tiptap/extension-hard-break`、`@tiptap/extension-mention`、`@tiptap/suggestion`、
  `@tiptap/extension-placeholder`。
- `lib/api.ts` + `lib/types.ts`：`commands.list`、`fs.search`；`messages.prompt` 载荷带 `contexts`/`images`；
  转出 `MessageImage` / `PromptCommandView` / `SkillCommandView` / `FsSearchResponse`。
- 新 hooks：`use-commands.ts`（按 cwd 拉取并缓存）、`use-file-search.ts`（防抖 + 缓存）。
- `composer.tsx`：接入编辑器，`onSend` 改为携带 `ComposerPayload`。
- `hooks/use-chat.ts`：`send` 签名由 `(text, seed?)` 扩为接收 `ComposerPayload`。
- `hooks/use-send-message.ts` + `lib/chat-reducer.ts`：`send` 接收载荷，乐观消息带图片 block 与上下文。
- `components/chat-panel.tsx`：`submit` 改读编辑器载荷；守卫由「非空文本」改为「文本 / 上下文 / 图片至少一项」；
  `parseGoalCommand` 只在纯文本时识别；发送失败按 `composerKeyOf(target)` 回填**完整载荷**（文本 + 上下文 + 图片引用）。
- `App.tsx`：`chat.send(...)` 调用点（计划批准、plan 反馈）改为传纯文本载荷。
- `components/message-item.tsx`：
  - 渲染 `image` block：`<img src={block.url}>` 懒加载 + 点击预览；乐观消息在刷新前先用本地 blob URL。
  - 预留 `file` block 渲染为可下载的文件 chip（本期不产生，见 §四.5）。
  - 用户消息把开头的 `<skill …>…</skill>` / `<context …>…</context>` 解析回 chip 展示，
    只显示用户原文（**按 `parseSkillBlock` 的语义自行解析**；前端不依赖 pi SDK）。
- i18n：`packages/i18n/src/locales/ui/{zh-CN,en}.ts` 中英齐平（菜单标题、占位符、附件操作、错误提示）。

## 八、自定义 primary agent

- 位置：全局 `$APP_HOME/agents/*.md`、项目 `.ucode/agents/*.md`（cwd → 项目根，近者优先，同 §三）；
  与现有自定义子角色同形（frontmatter + 正文）。同名时项目近者覆盖全局；内置三位可被同名覆盖。
- frontmatter 增加 `mode: primary | subagent | all`（缺省沿用现有子角色语义）；**允许与内置 `build` / `plan` / `ask`
  同名并覆盖**（去掉现有「与主模式同名一律拒绝」）。
- 能力字段：`description`（选择器展示）、`promptSection`（正文即 system，已具备）、
  `model` / `thinking` / `tools`（已具备）、`permissions`（已具备）；可选 `steps`（最大步数）、
  `hidden`（不进选择器）、`color`。
- 契约（已敲定）：`mode` 走**字符串 slug**，不新增字段——`SessionSummary` 的 `agent` 已占用「子角色」语义，
  再加 primary 字段会重叠。
  - `SESSION_MODES` 保留但重定位为「内置默认集合」；`SessionMode` 仍由它派生，只用于内置三位的默认与 UI 兜底。
  - `sessions/create|update` 的 `mode`：`z.string().regex(slug)`（slug 规则同自定义子角色：小写字母开头、kebab-case）。
  - `SessionSummary.mode: string`；服务端校验 slug 存在且为 primary（内置或自定义），非法返回 400。
  - 前端 `modeLabel` / `modeDescription` 对非内置 slug 回落到 `agents/list` 的 `label` / `description`。
  - `agents/list` 提供选择器数据（见 §五）。
- 提示词装配：自定义 primary 的 `promptSection` 非空时替换基线提示词；与 `APP_PROMPT_SOURCE=custom|pi`
  的叠放关系写入 `agent/prompt` 文档。
- 前端 agent 选择器区分 primary / subagent。

## 九、内置命令（前端动作）

前端维护内置动作注册表；`/` 菜单三组：**内置动作**（立即执行、不插入正文）｜**提示词命令**（插入 `/name`）｜
**技能**（插入 `/skill:name`）。解析优先级（仅文档开头）：内置动作 > 提示词命令 > `/skill:name`；未命中按普通文本发送。
内置动作不允许出现在文档中间（不落 `commandMention` 节点）。

**v1 集合（12 个，已敲定）**

| 命令 | 动作 | 支撑 |
| --- | --- | --- |
| `/new` | 新建会话（回到草稿阶段） | 现有 `sessions/create` |
| `/rename` | 重命名当前会话 | `sessions/update` + 重命名对话框 |
| `/archive` | 归档当前会话 | `sessions/archive` |
| `/fork` | 从当前会话分叉 | `sessions/fork` |
| `/stop` | 中断当前生成 | `messages/interrupt` |
| `/models` | 切换模型 | 现有 model-picker |
| `/thinking` | 切换思考档位 | 现有 thinking-picker |
| `/mode` | 切换模式（primary agent） | 现有 mode-picker + `agents/list` |
| `/settings` | 打开设置对话框 | 现有 settings-dialog |
| `/compact` | 手动压缩上下文 | **新增服务端接口**（现状只有 `compaction_start` / `compaction_end` 事件） |
| `/goal` | 目标模式（set / pause / resume / clear） | 现有 `parseGoalCommand`，收编进注册表 |
| `/help` | 列出全部命令 | 新增（纯前端） |

说明：
- 命令名用 `/mode`（与现有「模式」文案一致）；如需对齐 opencode 的 `/agents`，后续加别名，不占 v1。
- 本期不做 `/sessions`（侧栏已常驻）、`/copy`、`/export`、`/theme`、`/mcp`（无支撑或价值低）。

## 十、测试方案

server 侧 `node:test`，放同级 `__tests__/`（web 无测试运行器，走浏览器验收）。

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| CON-01 | `expandContexts` 读文件 | 产出 `<context path>` 包裹、正文标签被中和 |
| CON-02 | 路径越出 cwd / 不存在 | `invalid_request` / `path_not_found` |
| CON-03 | 超出单文件 / 总字节上限 | 截断并标注 |
| CON-04 | 目录引用 | 递归清单，受跳目录与条数上限约束 |
| CON-05 | 带 `startLine`/`endLine` 的文件引用 | 只取该区间 |
| AST-01 | `loadCommandAssets` 优先级 | 项目 `.ucode` > 项目 `.agents` > 全局 > 用户；`source` 正确 |
| AST-02 | 同名 collision | 高级别生效，低级别记诊断 |
| AST-03 | 技能广告 | `disable-model-invocation` 的技能不出现在系统提示词 |
| AST-04 | 坏文件 | 缺 `description` / 解析失败跳过，不影响其它 |
| IMG-01 | 合法图片 | 归一化后 mimeType / 尺寸合规 |
| IMG-02 | 超限且不可压缩 | `image_invalid` |
| SER-01 | `blocksOf` 的 image 分支 | 投影为 `{ type:"image", id, mimeType, url }` |
| ATT-01 | 附件路由 | 命中返回字节 + 缓存头；非法 `id` / 缺失 404 |
| ATT-02 | `putAttachment` / `resolveAttachment` | 内容寻址去重；非法 `id` 返回 null |
| IMG-03 | 同一图片重复发送 | 附件库只落一份（sha256 去重） |
| FSS-01 | `fs/search` 名称过滤 | 命中、排序稳定、`truncated` 正确 |
| RUN-01 | `admitPrompt` 三空 | `invalid_request` |
| RUN-02 | contexts + images 透传 | pool 收到展开后的 text 与归一化 images |

**L4 冒烟 / L5 浏览器**：`pnpm smoke` 建议加一条「带图片的 prompt 能拿到模型回复」；
`agent-browser` 走查 `@` 搜索与内联、`/` 菜单（三组）、图片粘贴、历史渲染、草稿（含图片）刷新恢复。

## 十一、验收

- 项目 / 全局 / `.agents` 三处资源都能被发现，同名按 §三 优先级生效。
- `@` 能搜到会话 cwd 内文件，选中后发送、模型能看到文件内容；目录引用给出清单。
- `/` 菜单三组可见；内置动作立即执行；选命令后整条消息按 pi 展开；选技能后展开为 `<skill …>` 块并在历史里显示为 chip；
  模型也能自动选用相关技能。
- 粘贴图片进附件区，发送后模型可见；历史消息里正常渲染；刷新后草稿（含图片）恢复。
- 自定义 primary agent 可选、可覆盖内置三模式。
- 越界路径、坏图片、三空载荷均给出可读错误。
- `pnpm check` 全绿（含新增单测）；`docs/api-reference.md` 与契约一致。

## 十二、风险与边界

- **命令位置约束**：命令与技能都由 pi 的整条匹配决定（`/name` / `/skill:name`），只能出现在文档开头；内联会被当作普通文本。
  内置动作同理，仅开头、且不落节点。
- **技能双通道**：技能清单由 pi 自动注入系统提示词供模型自动选用；`disable-model-invocation` 的技能不注入，
  只能 `/skill:name` 显式调用。
- **附件库与 JSONL 双份**：pi 仍会把 base64 写进会话 JSONL；附件库是它的服务端副本。本期不做附件 GC，随使用增长。
- **非图片附件不解析**：本期只存与引用，模型看不到正文；解析由后续插件 / MCP（保留工具名 `read_attachment`）提供。
- **草稿不跨端**：输入区草稿只在本端（localStorage + IndexedDB），不随会话同步；多端只共享已发送的历史。
- **附件路由无鉴权**：与其余接口一致（见 `TODO.md` P0）；P0 落地前不要暴露到不可信网络。
- **项目级目录约定**：`<cwd>/.ucode/` 由品牌 slug 派生，B 端换品牌后目录名随之变化。
- **`@` 仅限会话 cwd 内**：跨目录引用本期不做（越界直接拒绝）。
- **`fs/search` 的 `.gitignore` 支持**：首版以跳目录白名单 + 基础规则为主，与 pi `find`（fd）语义可能有差异。
- **草稿图片无回收**：IndexedDB 里未被任何草稿引用的 blob 依赖清理策略，先按需清理，不做后台 GC。
- **编辑历史不保留图片**：`messages/edit` 只收 `text`，编辑带图用户消息会丢图（本期接受，后续再补）。
- **编辑带 `@` 的消息会展开**：`messages/edit` 只收 `text`，编辑时会看到内联后的文件内容（含 `<context>`），
  重发等于把内联内容当正文（见 §四.6）。
- **只读模式与技能文件**：plan / ask / explore 读 `SKILL.md` 需走 skill 授权，不能被 `external_directory` 误拦（见 §六）。

## 十三、落地顺序

1. 契约（constants / messages / commands / fs / envelope）+ i18n 错误码文案。
2. server 资源发现（`agent/assets`，含 §三 优先级与 `.agents`）→ `agent/context` → `agent/attachment` / `agent/image`
   → `session-config` 装载（不手动拼技能清单）→ 权限：skill 读取放行 → `run` / `pool` / `/compact` → `serialize`
   → `routes/commands` / `routes/fs` / `routes/attachments` + 单测。
3. 自定义 primary agent（`agent/agents/custom.ts` + 契约 + 前端选择器）。
4. web 基础设施：`lib/draft-store`、`lib/composer-document`、`lib/composer-draft`、`api`、`use-commands` / `use-file-search`。
5. web 编辑器与发送链路：`components/composer/**` + `composer.tsx` 接入 + `use-chat` / `chat-panel` / `App.tsx` 编排
   + `use-send-message` / `chat-reducer` 乐观消息。
6. web 渲染与内置命令菜单：`message-item` 图片与 chip、`/` 三组菜单、i18n 文案。
7. 流程文档：`CHANGELOG.md`、`docs/api.md`、`pnpm api:docs`。
8. `pnpm check` + `pnpm build` + `agent-browser` 走查 + `pnpm smoke`，停下等 review。

## 十四、后续路线图

### P1 · 代码体验
- Formatter：写文件后自动格式化（prettier / biome 等）。
- LSP 集成。
- Compaction 细配置（pi settings 直给：`compaction.enabled` / `reserveTokens` / `keepRecentTokens`）。

### P2 · 会话与上下文
- Snapshots：`/undo` `/redo`，对话 + 文件一起回滚。
- Instructions 分层：AGENTS.md 逐层 + 嵌套按需发现（可抄 pi `loadProjectContextFiles`）。
- References（命名外部目录 / Git 仓库）：靠后。

### P3 · 对外接口与供应
- **SDK 往前提**：对外 OpenAPI + `@ucode/client`（含流式），复用 `@ucode/contracts` 生成。
- Provider / Model 深度、本地运行时发现（Ollama / LM Studio / vLLM）、MCP 高级（OAuth / 超时 / 协议版本）：靠后。

### P4 · 入口
- TUI / CLI 留位，实现时复用 `@earendil-works/pi-tui` 与 pi 的 `client` / `rpc-entry`。
- 桌面：占位。

### 低优先 TODO
- ACP（Agent Client Protocol）编辑器适配器。
- Plugins 生态（与当前固定工具集白名单策略冲突，需先改策略）。

### 不做（开发阶段）
- `/api/v1` 鉴权 + 默认回环监听（后续服务层单独处理）。
- Sharing。

## 十五、相对原 `composer.md` 的差异点

1. 全局目录由 `$APP_HOME/agent/{prompts,skills}` 改为 `$APP_HOME/{prompts,skills}`。
2. 删除手动 `formatSkillsForPrompt`，改为依赖 pi 自动注入（本文件决策 10、§六）。
3. 新增资源同名优先级表与 `.agents/skills` 兼容（§三）。
4. `/` 菜单由「命令 + 技能」两组扩为「内置动作 + 命令 + 技能」三组（决策 4、§九）。
5. 新增自定义 primary agent 章节（§八）与技能读取权限（§六）。
6. 新增后续路线图（§十四）。
7. 项目资源直接生效、不过 trust；项目级改为**祖先发现**（cwd → 项目根），并新增资源同名优先级表。
8. `/` 菜单三组并为内置动作敲定 12 个命令（§九）。
9. `mode` 契约放宽为 slug 字符串、新增 `agents/list`（§八、§五）。

## 十六、复盘（落地时的偏差）

> 待落地后补。
