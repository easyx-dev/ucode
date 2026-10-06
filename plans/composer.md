# 输入区：富文本与命令快捷输入

> 独立方案文档，不并入 [`agent-tools-and-modes.md`](./agent-tools-and-modes.md) 的阶段序列。
> 起因：母文档「新功能探索」提到的工具 / 提示词命令（prompt）/ skill，以及输入区的结构化输入与图片需求。
> 参考实现：opencode web 的 `packages/app/src/components/prompt-input/`（编辑器、附件、draft store）与
> `packages/opencode/src/image/image.ts`（图片归一化）。
>
> 状态：**已完成**：编辑器、命令 / 技能菜单、图片与附件（走服务端临时附件换 id）都已落地，
> 逐项变化见 `CHANGELOG.md`。

## 一、目标与范围

**目标**：把输入区从纯 `<textarea>` 换成轻量富文本编辑器，支持两类结构化输入与图片：

- **`@` 添加上下文**：从会话工作目录检索文件/文件夹，选中后把内容内联进本轮。
- **`/` 选择命令或技能**：一个菜单同时列出提示词模板（pi `PromptTemplate`）与技能（pi `Skill`），
  插入后命令占首位；技能序列化为 pi 认的 `/skill:name`。
- **图片粘贴**：剪贴板/拖拽图片进附件区，随 prompt 发给模型。

**做**：

- 编辑器内核用 Tiptap（ProseMirror），但**只装结构节点与 mention/suggestion**，不装任何排版 marks。
- 全局 + 项目级两处放置提示词命令与技能，新增列举接口；技能清单注入系统提示词，模型可自动调用。
- 附件：前端附件区 + 服务端归一化 + 内容寻址附件库 + 字节路由渲染（见决策 6）。
  图片走原生 vision；非图片（PDF/Word/Excel）本期只做**存储与引用**，解析留作插件 / MCP（见 §3.5）。
- 草稿：编辑器 JSON + 附件 blob（IndexedDB）持久化。

**明确不做**（留后续）：

- 排版能力（加粗、斜体、标题、列表、字号、颜色、背景等）——本次明确不要。
- 底栏选择器的改造（模型/档位/模式仍然保留原样）。
- 项目级资产的递归发现 / 层级目录（只读固定目录下的一层 + `SKILL.md` 规则由 pi 负责）。
- 上下文类型扩展（终端输出、历史会话、git diff、浏览器）——先做文件/文件夹。
- 非图片附件（PDF/Word/Excel）的解析——本期只留口子，后续以插件 / MCP 接入（见 §3.5）。

## 二、已锁定的决策

1. **编辑器内核用 Tiptap**，最小扩展集：`Document / Paragraph / Text / HardBreak / Mention / Suggestion / Placeholder`。
   不装 `StarterKit`（会带一排 marks），不装 `@tiptap/extension-image` / `@tiptap/markdown`。
2. **没有富文本排版**：编辑器只有纯文本、换行、原子 chip；不出现字体/字号/颜色/背景/加粗斜体。
3. **附件放编辑器上方的独立 attachment 行**，不内联进正文（对齐 opencode）。
4. **`/` 是唯一的命令入口，命令与技能同菜单**：提示词命令序列化为 `/name`，技能序列化为 `/skill:name`。
   pi 的展开要求整条文本匹配 `/name args` 或 `/skill:name args`（`expandPromptTemplate` 正则 `^\/…$`、
   `_expandSkillCommand` 要求 `startsWith("/skill:")`），所以 `/` 只在文档开头生效，选中后命令占首位、后面是参数。
   不单独引入 `$` 前缀——业内（Claude Code / Cursor / Codex）都把技能并进 `/` 菜单，只有 Codex 的 app 用 `$`。
5. **`@` 内联任意位置**：发送时从正文剥离路径到 `contexts[]`，服务端读内容并用不可信边界 `<context>` 前置。
6. **附件：内容寻址附件库（图片与非图片统一存储）**。图片经 pi `resizeImage` 归一化（2000×2000、base64 5MB）
   后按 `sha256` 落到 `$APP_HOME/app/attachments/` 并发给模型做原生 vision；非图片原样入库、只做引用
   （解析见决策 12）。`MessageBlock` 以 `{ id, mimeType, url }` 引用，前端按 `url` 懒加载；不内联 base64——
   那更适合本地单机 server，本仓库要支持局域网/远程与多端看同一会话。
7. **草稿只在本端**：草稿（文本 / 上下文 / 命令 + 附件 blob）按 opencode 走 localStorage + IndexedDB，
   不做跨端同步；只有**发出去的历史**才由服务端持有、多端可见。
8. **提示词命令与技能目录**：全局 `$APP_HOME/agent/{prompts,skills}` + 项目级 `<cwd>/.ucode/{prompts,skills}`
   （`.<brand.slug>`，与 `~/.ucode` 命名一致）。会话装配禁用 pi 默认目录，只认这两处。
9. **不新增 web 以外的运行时依赖**：图片归一化复用 pi 已导出的 `resizeImage`（内置 Photon wasm）。
10. **技能默认允许模型自动调用**：把技能清单经 `formatSkillsForPrompt` 注入系统提示词
    （`disable-model-invocation` 的技能不注入），同时保留 `/skill:name` 显式调用，对齐 Claude Code / Cursor 的
    「自动 + 显式」双通道。
11. **附件增强**（对齐 Cursor / Copilot / opencode）：`@` 支持文件与文件夹、可带行/选区范围；
    粘贴大段文本可一键转成附件；命令带 `argument-hint` 前端提示；附件以可删 chip 呈现。
12. **非图片附件只留口子**：本期不引入任何文档解析依赖。附件库、`MessageBlock` 预留的 `file` 变体、
    消息里的附件引用标记、以及保留的自研工具名 `read_attachment` 共同构成集成点；
    PDF/Word/Excel → 文本的解析作为后续插件 / MCP 接入（参考 opencode 的 `opencode-parser` 做法）。

## 三、编辑器设计（前端核心）

### 3.1 文档模型

Tiptap 文档只含段落、文本、硬换行与两个原子 mention 节点：

| 触发 | 节点 | attrs | 序列化到正文 | 说明 |
| --- | --- | --- | --- | --- |
| `@` | `contextMention` | `path`、可选 `startLine`/`endLine` | 无（进 `contexts[]`） | 可内联在任意位置 |
| `/` | `commandMention` | `kind`(`prompt` \| `skill`)、`name` | `/name` 或 `/skill:name` | 仅文档开头 |

两个节点由 `Mention.extend({ name })` 派生（或直接用 `@tiptap/suggestion` 自建节点），各自绑定
`char`、下拉数据源与 `allow`。`/` 的 `allow` 限定 `range.from === 1`；同一个提示菜单内分组展示命令与技能。

### 3.2 发送载荷

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

### 3.3 草稿与附件

- `lib/composer-draft.ts`：草稿在原有 `text` 基础上增 `parts: ComposerPart[]` 与 `attachments: string[]`（blob id）。
  读取时若只有旧 `text`，按单个 text part 处理（本地草稿，不做迁移脚本）。
- `lib/draft-store.ts`：原生 IndexedDB（库名 `` `${brand.slug}-drafts` ``，store `blobs`），
  `putBlob(blob) -> id`（SHA-256 hex）、`getBlob(id)`、`objectUrl(id)`（缓存 `URL.createObjectURL`）。
- 粘贴/拖拽图片：客户端先用 canvas 预压缩（最长边 2000px、目标 ≤ 5MB）再入 store；历史 blob 无引用时按需清理。
- 粘贴大段文本（阈值对齐 opencode：≥ 8000 字符或 ≥ 120 行）：提示可一键转成附件，不直接灌进正文。

### 3.4 组件

`apps/web/src/components/composer/`：

- `editor.tsx`：Tiptap 实例、扩展装配、内容回写、Enter 发送 / Shift+Enter 换行、IME、Placeholder。
- `suggestion-list.tsx`：`@` / `/` 共用的下拉（键盘导航，锚定光标 `getBoundingClientRect()`）。
- `context-suggestion.ts` / `command-suggestion.ts`：两个触发器的数据与行为；命令下拉里命令与技能分组。
- `text-attachment.ts`：粘贴大段文本转附件的判定与渲染。
- `attachment-strip.tsx`：编辑器上方的附件行——图片显示缩略图（可点开预览），非图片显示可下载的文件 chip。
- `use-composer-images.ts`：粘贴/拖拽 → store → 附件状态。

### 3.5 附件扩展口子（非图片，本期只留口）

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

### 3.6 `@` 上下文的数据流

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
- **「编辑并重发」退化成展示展开后的文件内容**（见 §九）。
- token 预算靠 `CONTEXT_MAX_*` + 截断兜。

**更干净的历史 / 编辑形态**（本期不做）：sidecar 存 `entryId → ContextRef[]` 与原始文本，或等 pi 支持 file part。

## 四、契约（packages/contracts）

- `constants.ts`：
  - `IMAGE_MIME_TYPES = ["image/png","image/jpeg","image/webp","image/gif"]`、`type ImageMimeType`。
  - `PROMPT_MAX_IMAGES`、`PROMPT_MAX_CONTEXTS`、`MESSAGE_IMAGE_MAX_BASE64_BYTES`。
  - `COMMAND_ASSET_SOURCES = ["global","project"]`、`type CommandAssetSource`。
- `messages/input.ts`：
  - 新增 `messageImageSchema = { data: base64(1..上限), mimeType: IMAGE_MIME_TYPES }`。
  - 新增 `contextRefSchema = { path: string; startLine?: int; endLine?: int }`。
  - `promptInputSchema` 增 `contexts: ContextRef[] (≤ PROMPT_MAX_CONTEXTS).optional()`、
    `images: MessageImage[] (≤ PROMPT_MAX_IMAGES).optional()`；
    `text` 放宽为可空串（有 `contexts` 或 `images` 时允许无正文，路由层再校验「三者至少一项」）。
  - 导出 `MessageImage` / `MessageImageRequest` / `ContextRef`。
- `messages/output.ts`：`MessageBlock` 增 `{ type: "image"; id: string; mimeType: string; url: string }`；
  同期**预留** `{ type: "file"; id: string; mimeType: string; name: string; size: number; url: string }`
  （本期不产生，见 §3.5）。
- 新增附件**字节路由**（非 JSON 例外，同 `/events`，不走封套、用 GET）：
  `GET {API_BASE_PATH}/attachments/<id>` 按 `id`（sha256）返回字节 + `Content-Type` /
  `Cache-Control: immutable` / `ETag`；与类型无关（图片/文档同一路由）；无 zod 契约，在 `docs/api.md` 的例外处登记。
- 新域 `commands/{input,output}.ts`：
  - `commandsListInputSchema = { sessionId?: string; cwd?: string }`（优先 `sessionId` 解析 cwd）。
  - `PromptCommandView = { name; description; argumentHint?; source: CommandAssetSource }`
  - `SkillCommandView = { name; description; source: CommandAssetSource }`
  - `CommandsListResponse = { prompts: PromptCommandView[]; skills: SkillCommandView[] }`（双集合，
    按「详情」形态返回，不带 `total`）
- `fs/`：新增 `fsSearchInputSchema = { path?: string; q?: string; limit? }`（默认/上限按 `docs/api.md` 的 `limit` 约定）、
  `FsSearchResponse = { path: string; entries: FsEntry[]; truncated: boolean }`。
  `search` 是 `docs/api.md` 动作词表外的**新动词**，需在该表登记；或改用 `list` + 递归/查询参数，避免扩张词表。
- `envelope.ts`：新增 `imageInvalid: "image_invalid"`。
- `index.ts`：导出新域。
- `packages/i18n/src/error-messages.ts` + `locales/domain/{zh-CN,en}.ts`：补 `image_invalid` 映射与文案。

## 五、server

- `constants.ts`：`SKILLS_DIRNAME`、`PROMPTS_DIRNAME`、`PROJECT_CONFIG_DIRNAME`（`.${brand.slug}`）、
  `ATTACHMENTS_DIRNAME`、`CONTEXT_MAX_FILES`、`CONTEXT_MAX_FILE_BYTES`、`CONTEXT_MAX_TOTAL_BYTES`、
  `FS_SEARCH_MAX_ENTRIES`、`FS_SEARCH_SKIP_DIRS`、`IMAGE_MAX_DIMENSION`、`IMAGE_MAX_BASE64_BYTES`。
- 新 `agent/assets/`：
  - `paths.ts`：`commandAssetPaths(cwd, agentDir)` → `{ skillPaths, promptPaths }`（全局 + 项目级，去重）。
  - `index.ts`：`loadCommandAssets({ cwd, agentDir })` 用 pi 已导出的 **`DefaultResourceLoader`**
    （传 `noSkills` / `noPromptTemplates` + `additionalSkillPaths` / `additionalPromptTemplatePaths`，
    `reload()` 后读 `getPrompts()` / `getSkills()`）返回 `{ prompts, skills }`，映射为**不含绝对路径**的视图
    （`name` / `description` / `argumentHint` / `source`）。
    注意：`loadPromptTemplates` **不是** pi 包根导出（根导出只有 `loadSkills` 与 `PromptTemplate` 类型），
    不可直接 `import`。
- `agent/session-config.ts`：`createSessionLoader` 传 `noSkills: true` / `noPromptTemplates: true` +
  `additionalSkillPaths` / `additionalPromptTemplatePaths`（来自 `commandAssetPaths`），
  使 pi 的 `/name`、`/skill:name` 展开只认我们的目录、不读 `cwd/.pi/`。
  系统提示词拼上技能清单 `formatSkillsForPrompt(loader.getSkills())`（已自动排除 `disable-model-invocation`），
  让模型能自动选用技能。
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
- 新 `routes/commands/index.ts`：`POST /commands/list`（按 `sessionId` 解析 cwd，缺省 `env.workspaceRoot`）。
- `routes/fs/index.ts`：新增 `POST /fs/search`（受限 walker，`FS_SEARCH_SKIP_DIRS` + 基础 `.gitignore` 可选）。
- 新 `routes/attachments/index.ts`：`GET /attachments/:id` —— 非 JSON，直接返回字节；校验 `id` 为 64 位 hex，
  只读附件库目录（防路径穿越），带 `Content-Type` / `Cache-Control: immutable` / `ETag`，缺失 404。
- `index.ts`：挂 `/commands` 与 `/attachments`；`app.ts` 无需改（`commands` 只读、直接取 `services.sessions`）。

## 六、前端

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
  - 预留 `file` block 渲染为可下载的文件 chip（本期不产生，见 §3.5）。
  - 用户消息把开头的 `<skill …>…</skill>` / `<context …>…</context>` 解析回 chip 展示，
    只显示用户原文（**按 `parseSkillBlock` 的语义自行解析**；前端不依赖 pi SDK）。
- i18n：`packages/i18n/src/locales/ui/{zh-CN,en}.ts` 中英齐平（菜单标题、占位符、附件操作、错误提示）。

## 七、测试方案

server 侧 `node:test`，放同级 `__tests__/`（web 无测试运行器，走浏览器验收）。

| 编号 | 用例 | 预期 |
| --- | --- | --- |
| CON-01 | `expandContexts` 读文件 | 产出 `<context path>` 包裹、正文标签被中和 |
| CON-02 | 路径越出 cwd / 不存在 | `invalid_request` / `path_not_found` |
| CON-03 | 超出单文件 / 总字节上限 | 截断并标注 |
| CON-04 | 目录引用 | 递归清单，受跳目录与条数上限约束 |
| CON-05 | 带 `startLine`/`endLine` 的文件引用 | 只取该区间 |
| AST-01 | `loadCommandAssets` | 全局 + 项目级合并，`source` 正确，坏文件跳过 |
| AST-02 | 技能清单注入 | `formatSkillsForPrompt` 输出排除 `disable-model-invocation` 的技能 |
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
`agent-browser` 走查 `@` 搜索与内联、`/` 菜单（命令 + 技能）、图片粘贴、历史渲染、草稿（含图片）刷新恢复。

## 八、验收

- `@` 能搜到会话 cwd 内文件，选中后发送、模型能看到文件内容；目录引用给出清单。
- `/` 菜单里命令与技能分组可见；选命令后整条消息按 pi 展开，选技能后展开为 `<skill …>` 块并在历史里显示为 chip；
  模型也能自动选用相关技能。
- 粘贴图片进附件区，发送后模型可见；历史消息里正常渲染；刷新后草稿（含图片）恢复。
- 越界路径、坏图片、三空载荷均给出可读错误。
- `pnpm check` 全绿（含新增单测）；`docs/api-reference.md` 与契约一致。

## 九、风险与边界

- **命令位置约束**：命令与技能都由 pi 的整条匹配决定（`/name` / `/skill:name`），只能出现在文档开头；内联会被当作普通文本。
- **技能双通道**：技能清单注入系统提示词供模型自动选用；`disable-model-invocation` 的技能不注入，只能 `/skill:name` 显式调用。
- **附件库与 JSONL 双份**：pi 仍会把 base64 写进会话 JSONL；附件库是它的服务端副本。本期不做附件 GC，随使用增长。
- **非图片附件不解析**：本期只存与引用，模型看不到正文；解析由后续插件 / MCP（保留工具名 `read_attachment`）提供。
- **草稿不跨端**：输入区草稿只在本端（localStorage + IndexedDB），不随会话同步；多端只共享已发送的历史。
- **附件路由无鉴权**：与其余接口一致（见 `TODO.md` P0）；P0 落地前不要暴露到不可信网络。
- **项目级目录约定**：`<cwd>/.ucode/` 由品牌 slug 派生，B 端换品牌后目录名随之变化。
- **`@` 仅限会话 cwd 内**：跨目录引用本期不做（越界直接拒绝）。
- **`fs/search` 的 `.gitignore` 支持**：首版以跳目录白名单 + 基础规则为主，与 pi `find`（fd）语义可能有差异。
- **草稿图片无回收**：IndexedDB 里未被任何草稿引用的 blob 依赖清理策略，先按需清理，不做后台 GC。
- **编辑历史不保留图片**：`messages/edit` 只收 `text`，编辑带图用户消息会丢图（本期接受，后续再补）。
- **编辑带 `@` 的消息会展开**：`messages/edit` 只收 `text`，编辑时会看到内联后的文件内容（含 `<context>`），重发等于把内联内容当正文（见 §3.6）。

## 十、落地顺序

1. 契约（constants / messages / commands / fs / envelope）+ i18n 错误码文案。
2. server：`agent/assets` → `agent/context` → `agent/attachment` / `agent/image` → `session-config` 装载 → `run` / `pool` → `serialize`
   → `routes/commands` / `routes/fs` / `routes/attachments` + 单测。
3. web 基础设施：`lib/draft-store`、`lib/composer-document`、`lib/composer-draft`、`api`、`use-commands` / `use-file-search`。
4. web 编辑器与发送链路：`components/composer/**` + `composer.tsx` 接入 + `use-chat` / `chat-panel` / `App.tsx` 编排 + `use-send-message` / `chat-reducer` 乐观消息。
5. web 渲染：`message-item` 图片与 chip、i18n 文案。
6. 流程文档：`CHANGELOG.md`、`docs/api.md`、`pnpm api:docs`。
7. `pnpm check` + `pnpm build` + `agent-browser` 走查 + `pnpm smoke`，停下等 review。

## 十一、复盘（落地时的偏差）

> 待落地后补。
