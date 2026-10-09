# 消息里的图片 / 附件改成文字 token

> 依赖：[`ui-convergence.md`](./ui-convergence.md) 批次二（附件内联成 chip、编辑态复用输入区编辑器）——
> 本次是它的收尾修订；标记口径见 `packages/contracts/src/messages/markers.ts`（`图片 N` / `附件 N.<ext>`）。
> 边界与 [`composer-layout.md`](./composer-layout.md)（输入区与空态布局重构）相邻：那份不动消息区、也不
> 碰 chip 形态，只加文件选择入口；同一处 `composer/attachment-chip.tsx` 各自改各自的，可并行落地。
>
> 状态：**未开始**（计划定稿，待实施）。

## 一、背景与目标

附件现在在三个位置都以「视觉形态」出现，正文排版被图片撑坏：气泡里的大图、编辑器里缩到 16px 的缩略图
（用户原话：预览丑、编辑时缩小了照片还是丑）。

- 编辑器 chip：图片显 `size-4` 缩略图（`business/composer/attachment-chip.tsx:39`），文件显图标 + 文件名；
- 用户消息气泡内联：`max-h-40` 缩略图（`business/user-message.tsx:70` 的 `InlineImage`）；
- 兜底媒体行（早期消息 / 标记对不上的块）：图片走 `BlockView` 的 `max-h-96` 大图、文件走带框的
  `AttachmentLink`（`business/message-blocks.tsx:15` / `:88`）。

**目标**：图片与附件在正文里一律是**文字 token**——`<图片1>` / `<report.pdf>`，配一套克制的样式块；
图片点开原图弹层，附件点开下载；输入区编辑器与消息回放共用同一套形态。序号与发送时写进正文的
`图片 N` 标记同口径（`lib/composer-document.ts:73` 的 `docToPayload`）。

**做**：

- 新增共享的 `AttachmentToken`（`business/attachment-token.tsx`）；
- 序号口径下沉为纯函数 `attachmentOrdinalInDoc`（`lib/composer-document.ts`），编辑器显示与载荷标记共用一份；
- 用户消息的内联段与兜底媒体行改渲染 token；
- 删掉 `AttachmentThumb`（缩略图已无消费者）；
- 同步 `DESIGN.md` 消息区表格与 `packages/i18n` 的 en 目录。

**明确不做**：assistant 的图片块与 markdown 图片（`BlockImage`、`MarkdownImage`）一行不动；不改载荷与
标记协议（`docToPayload`、`contracts/messages/markers.ts`、服务端的按标记展开都不动）；不新增「附件内容
预览弹层」；不回填老消息。

## 二、范围界定

| 场景 | 现状 | 本次 |
| --- | --- | --- |
| 输入区 / 编辑态编辑器的图片 | `size-4` 缩略图 | `<图片n>`，点击开原图弹层 |
| 输入区 / 编辑态编辑器的文件 | 图标 + 文件名 | `<文件名>`，纯文字不可点（落光标、Backspace 删除） |
| 用户消息里的 `图片 N` 标记 | `max-h-40` 缩略图 | `<图片n>`，点击开原图弹层 |
| 用户消息里的附件引用行 | `rounded-full` chip + 图标 + `<a download>` | `<文件名>` token + 同样的 `<a download>` |
| 兜底媒体行（无标记的图片 / 文件块） | `max-h-96` 大图、带框附件 | 同样的 token（图片序号取块顺序） |
| 上传中的占位 | 灰色脉冲方块 / 文件名 | `<图片n>` / `<文件名>` + 脉冲淡出，不可点 |
| 草稿恢复（文档即草稿） | 无额外存储 | 不变：序号渲染时现算，不落盘 |
| assistant 的图片块 / markdown 图片 | `max-h-96` 大图 | **不变**（本轮范围外） |

## 三、已锁定的决策

1. **token 是字面尖括号文本**：`<图片1>` / `<report.pdf>`，尖括号随 token 一起渲染，读屏只读中间那段
   （两个尖括号 `aria-hidden`）。
2. **图片用序号、附件用文件名**：图片序号与正文标记 `图片 N` 同口径；文件名给辨识度，过长截断、`title`
   与下载名给全名。
3. **范围只到输入区编辑器与用户消息**：assistant 的图片块与 markdown 图片保持现状（模型产出的图仍按原样铺开）。
4. **序号渲染时现算，不写进节点 attrs**：写 attrs 就得在插入 / 删除时配一个 appendTransaction 插件重编号；
   按文档顺序现算天然正确——删掉第一张图，第二张立刻变 `<图片1>`。
5. **token 只管形态，交互交给调用方**：`AttachmentToken` 渲染 `<span>`，包 `button`（开预览）还是 `a`（下载）
   由调用点决定，不在组件里长 `as` / `href` 分支。
6. **编辑器里的文件 token 不可点**：编辑区点附件只落光标（Backspace 删除），误触不该触发下载；气泡里点附件
   才是下载。图片两处都可点开原图弹层。
7. **不新增弹层种类**：沿用现有「图片预览」声明式弹层（`business/attachment-preview.tsx:45` 的
   `useAttachmentPreview`），不做 PDF / 文本内容预览。

## 四、改动清单

### 1. `packages/ui/src/lib/composer-document.ts` — 序号纯函数

紧接 `docToPayload`(:73) 之后新增：

```ts
/**
 * 附件在文档里的同类序号（1 起）：与 `docToPayload` 写进正文的 `图片 N` / `附件 N` 同一口径，
 * 编辑器据此显示 `<图片n>`。`key` 取节点的 id（上传中的占位取 tempId）——两者在文档内都唯一。
 */
export const attachmentOrdinalInDoc = (
  doc: ComposerNode | null | undefined,
  key: string,
  kind: AttachmentView["kind"],
): number => {
  // 按文档顺序只数同类节点，命中 key 时返回当前计数；走完没命中返回 0
};
```

`kind` 用 `AttachmentView["kind"]`（本文件已 import `AttachmentView`），不新引 `AttachmentKind`。
文件头注释补一句「序号口径由写标记的 `docToPayload` 与渲染用的 `attachmentOrdinalInDoc` 共担」。

**已知的口径差**：`docToPayload` 会跳过没有 id 的占位且不计数（:105），渲染端把占位算进去——上传期间两者
短暂不一致，但 `hasPendingUploads` 挡着发送，落盘前必然收敛（上传一落定就有 id）。

### 2. `packages/ui/src/lib/__tests__/composer-document.test.ts` — 用例

- 两类各数各的：两张图 + 一个文件 → 两张图 `1` / `2`，文件 `1`；
- 跨段落接着数：第二段里的图片序号接第一段；
- 占位占号：`tempId` 节点与有 id 的节点一视同仁（`key` 命中即返回）；
- 认不出：`key` 不在文档里返回 `0`；同类里找不到（`kind` 不匹配）返回 `0`。

### 3. `packages/ui/src/business/attachment-token.tsx`（新）

```tsx
/** 正文里的附件文字 token：图片 `<图片1>`、其余 `<文件名>`；开预览 / 下载由调用方包一层 */
export type AttachmentTokenProps = {
  /** 附件类别：图片显示序号，其余显示文件名 */
  kind: AttachmentView["kind"];
  /** 图片的同类序号，1 起（与正文标记 `图片 N` 同口径） */
  index?: number;
  /** 非图片附件的显示名 */
  name?: string | null;
  /** 上传中：淡出一档并脉冲，且不可点 */
  pending?: boolean;
  className?: string;
};

export function AttachmentToken({ … }: AttachmentTokenProps) { … }
```

- 形态：`inline-flex max-w-48 items-baseline rounded-md border border-border bg-muted/40 px-1 py-px align-baseline font-mono text-xs text-muted-foreground`；
- 结构：`<span aria-hidden>{"<"}</span>` + 中间那截（文件名 `min-w-0 truncate`）+ `<span aria-hidden>{">"}</span>`；
- 文案：图片走 `t("图片 {{index}}", { index })`，其余用 `name || id`；
- 状态：`pending` → `animate-pulse opacity-60`；hover 与失败态（`line-through opacity-60`）由调用点用
  `className` 给，与前缀 `hover:` 类不冲突（`cn` 走 twMerge）。

### 4. `packages/ui/src/business/composer/attachment-chip.tsx` — 编辑器

- `NodeViewWrapper` 只留 `inline-block align-baseline`：token 自带描边与底色，wrapper 再带一层会成两层框；
- 序号用 Tiptap v3 的 `useEditorState`（选择值不变不重渲染）：

```tsx
const key = id || tempId;
const ordinal = useEditorState({
  editor,
  selector: ({ editor: target }) =>
    attachmentOrdinalInDoc(target.getJSON() as ComposerNode, key, kind),
});
```

- 图片：有 id 时包 `button`（`onMouseDown` 拦选区变化 → `open({ id, name })`），无 id 时不可点；`title` 取
  `name`，空则 `t("图片预览")`；
- 文件：`<span>` 包 token（`title={name}`），不拦事件——原子节点的落光标 / 整体删除与其它 mention 一致；
- `useAttachmentPreview()` 留在节点视图里（弹层挂在 chip 旁）；文件头注释按新形态改写。

### 5. `packages/ui/src/business/user-message.tsx` — 消息回放

- `InlineImage`(:70) 改成 token 按钮：`<AttachmentToken kind="image" index={index} />`，点击开原图弹层；
- 附件分段（:199 的 `AttachmentLink`）改成 `<a download>` 包 token，字节用 `useAttachmentUrl` 取，失败态
  仍是划线淡出；
- 兜底媒体行（:117 的 `mediaBlocks`、:172 的 `BlockView`）不再走 `BlockView`：图片块渲染成可点 token
  （序号 `imageBlocks.indexOf(block) + 1`）、文件块渲染成可下载 token；
- 随之删掉 `message-blocks`（`AttachmentLink` / `BlockView`）与 `attachment-preview` 的 `AttachmentThumb`
  导入；`useAttachmentPreview` 继续用。

### 6. `packages/ui/src/business/attachment-preview.tsx` — 收尾

- 删 `AttachmentThumb`(:19) 与 `ImageOff` 导入(:8)——缩略图已无消费者；
- 文件头注释改成「token 点开后的原图弹层」；
- `useAttachmentPreview` / `PreviewImage` 不动。

### 7. `packages/i18n/src/locales/ui/en.ts` — 文案

加 `"图片 {{index}}": "Image {{index}}"`（放在 `图片预览`(:198) 附近）。zh-CN 不登记——中文原文 key 靠
回退并插值，登记了会被 `pnpm verify` 的 i18n 校验判为冗余。

### 8. `DESIGN.md` — 消息区表格

「用户消息的 chip」一行(:199)改写：句子里的 `@` 引用与句子外的技能 / 命令仍是 `rounded-full` + `bg-muted` +
`text-xs` 的 chip；图片与附件改成带描边的等宽文字 token（`rounded-md` + `border-border` + `bg-muted/40` +
`font-mono text-xs`），点图片开原图弹层、点附件下载；并写明输入区编辑器与消息里共用同一套 token。

## 五、测试

- `packages/ui/src/lib/__tests__/composer-document.test.ts`：§2 的用例（`node:test` + `node:assert/strict`）。
- 组件层不引测试框架：本仓库 UI 没有组件测试，形态与交互按 §七 在真实浏览器走查。

## 六、文档与变更日志

- `DESIGN.md`：见 §8。
- `CHANGELOG.md`：**不动**——没有 pnpm 脚本 / 环境变量 / 依赖 / 目录结构 / 对外接口的变化（附件与标记协议
  一行未改）。
- `plans/ui-convergence.md`：批次二记录的是当时的落地形态（写着缩略图 chip），属历史记录，不回改。

## 七、验收

- `pnpm check` 一轮全绿（含 i18n 的硬编码中文与 en 目录校验）。
- 真实浏览器走查一次（`pnpm build && pnpm start` → `http://127.0.0.1:19688`）：
  1. 粘贴「一张图 + 一个 pdf」→ 编辑器里就地是 `<图片1>` / `<report.pdf>`，无缩略图、行高与普通文本一致；
  2. 点编辑器里的 `<图片1>` → 弹原图；点 `<report.pdf>` → 只落光标，不触发下载；
  3. 发送后气泡里是同样的 token，气泡高度不再被图片撑开；点图片弹层、点附件下载；
  4. Backspace 删掉第一张图 → 剩下的图片变 `<图片1>`（与发送后的正文标记一致）；
  5. 再粘一张图 → `<图片2>`；上传中先脉冲、落定后可点；
  6. 编辑这条消息 → token 原样还原、序号正确，重发后正文标记与界面一致；
  7. 早期消息（正文无标记，走兜底媒体行）→ 仍是 token，不出现大图；
  8. 长文件名截断且 `title` 给全名；字节取不回来时 token 划线淡出。
- 回归确认：assistant 的图片块与 markdown 图片仍是原样（本轮未动）。

## 八、暂不做 / 已否决

- **附件内容预览弹层**（PDF / 文本在弹层里看内容）：否决。要引 PDF 渲染依赖，超出「简单克制」的范围；
  附件 token 点击直接下载已经够用。
- **把序号写进节点 attrs**：否决，见决策 4。
- **给 token 加图标**（文件类型图标 / 图片图标）：否决。纯文字块更干净，图标在密集正文里反而更吵。
- **assistant 侧图片 token 化**：本轮不做，见决策 3。
- **老消息回填**：不做（`AGENTS.md` 的兼容性约定：不维护向后兼容，也不写数据迁移）。
