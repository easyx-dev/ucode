/**
 * 附件在正文里的位置标记：编辑器按节点顺序写、服务端按同一套消费，两端共用这里的字面量。
 *
 * 图片与非图片都内联，但落地形态不同（受 pi 的 `prompt(text, images)` 限制——它只接受
 * 「一整段文本 + 图片数组」，图片无法真正落在句子中间）：
 *
 * - 编辑器 / 载荷：图片写 `图片 N`、非图片写 `附件 N.<ext>`，N 按各自类型在本条消息内的出现顺序（1 起）。
 * - 会话条目：非图片的标记被服务端替换成引用行 `[附件: <显示名> (id: <sha256>)]`（模型据此看到真实
 *   文件名与 id），图片的标记原样留着，图片本体按标记顺序附在文本之后。
 *
 * 解析要求「标记顺序与附件顺序一致」（见 `markersMatchAttachments`）：不一致时调用方整段退回
 * 「引用行前置 + 图片按原顺序」的老路径，而不是猜。
 */
import type { AttachmentKind } from "../constants";

/** 文件名里的扩展名：只认 ASCII 字母数字、长度 1–10、且不是整个名字；认不出时返回 null */
const attachmentExtensionOf = (name: string | null): string | null => {
  if (!name) return null;
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(name);
  return match ? (match[1] as string).toLowerCase() : null;
};

/** 图片标记的开头；解析端先用它快速排除，再交给正则 */
export const IMAGE_MARKER_PREFIX = "图片 ";
/** 非图片附件标记的开头（`附件 ` 里带空格，本模块内部用，不外发） */
const ATTACHMENT_MARKER_PREFIX = "附件 ";
/** 展开后的引用行开头：正文里取代 `附件 N.<ext>` 标记 */
export const ATTACHMENT_REF_PREFIX = "[附件: ";

/** 第 N 张图片的标记（`index` 从 0 起） */
export const imageMarker = (index: number): string => `${IMAGE_MARKER_PREFIX}${index + 1}`;

/** 第 N 个非图片附件的标记（`index` 从 0 起）；文件名认不出扩展名时只写 `附件 N` */
export const attachmentMarker = (index: number, name: string | null): string => {
  const ext = attachmentExtensionOf(name);
  return `${ATTACHMENT_MARKER_PREFIX}${index + 1}${ext ? `.${ext}` : ""}`;
};

/** 正文里的引用标记：`@路径`（行范围只进 `contexts`，正文里不带） */
export const contextMarker = (path: string): string => `@${path}`;

/** 正则字面量转义：前缀里的 `[` 不转义会被当成字符集开头 */
const escapeRegExp = (value: string): string => value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 标记的匹配：`图片 12` 或 `附件 3.pdf`（扩展名可缺省）。
 * 只在本模块的 `matchAll` 里用——带 `g` 的正则被外部 `exec` 过会留下 `lastIndex`，
 * `matchAll` 就从中途开始扫了；别把它导出去。
 */
const ATTACHMENT_MARKER_PATTERN = new RegExp(
  `${escapeRegExp(IMAGE_MARKER_PREFIX)}(\\d+)|${escapeRegExp(ATTACHMENT_MARKER_PREFIX)}(\\d+)(?:\\.([A-Za-z0-9]{1,10}))?`,
  "g",
);

/** 正文里的一处标记：位置 + 类型 + 序号（1 起）+ 写出来的扩展名 */
export type AttachmentMarkerHit = {
  kind: AttachmentKind;
  /** 同类附件里的序号，1 起（与标记里的数字同口径） */
  index: number;
  /** 标记写出来的扩展名（小写）；没写时为 null */
  ext: string | null;
  from: number;
  to: number;
};

/** 扫描正文里的标记，按出现顺序返回 */
export const scanAttachmentMarkers = (text: string): AttachmentMarkerHit[] => {
  const hits: AttachmentMarkerHit[] = [];
  for (const match of text.matchAll(ATTACHMENT_MARKER_PATTERN)) {
    const iconText = match[1];
    const raw = iconText ?? match[2] ?? "";
    const index = Number.parseInt(raw, 10);
    if (!Number.isInteger(index) || index <= 0) continue;
    hits.push({
      kind: iconText === undefined ? "file" : "image",
      index,
      ext: match[3]?.toLowerCase() ?? null,
      from: match.index,
      to: match.index + match[0].length,
    });
  }
  return hits;
};

/** 对得上的判断依据：附件的类型与显示名（顺序即载荷顺序） */
export type MarkerTarget = { kind: AttachmentKind; name: string | null };

/**
 * 标记是否与附件列表对得上：图片按 `图片 1..K`、非图片按 `附件 1..M` 各自连续升序出现，
 * 数量与列表一致，且非图片写出的扩展名与该附件的扩展名相同；一条附件都不能少。
 *
 * 最后那条扩展名校验用来防「用户自己打的同名标记」：附的是 `report.pdf` 而正文写着 `附件 1.txt`
 * 时判为对不上，整段退回前置引用——宁可退化，也不去改用户的话。
 */
export const markersMatchAttachments = (
  hits: readonly AttachmentMarkerHit[],
  attachments: readonly MarkerTarget[],
): boolean => {
  if (attachments.length === 0) return hits.length === 0;

  const images = attachments.filter((item) => item.kind === "image");
  const files = attachments.filter((item) => item.kind !== "image");
  const imageHits = hits.filter((hit) => hit.kind === "image");
  const fileHits = hits.filter((hit) => hit.kind === "file");

  const sequential = (list: readonly AttachmentMarkerHit[], count: number): boolean =>
    count > 0 && list.length === count && list.every((hit, offset) => hit.index === offset + 1);
  if (images.length > 0 && !sequential(imageHits, images.length)) return false;
  if (files.length > 0 && !sequential(fileHits, files.length)) return false;
  if (images.length === 0 && imageHits.length > 0) return false;
  if (files.length === 0 && fileHits.length > 0) return false;

  return fileHits.every(
    (hit, offset) => hit.ext === attachmentExtensionOf(files[offset]?.name ?? null),
  );
};

/**
 * 展开后的附件引用行：正文里取代 `附件 N.<ext>` 标记。显示名里的方括号与换行会破坏解析，统一换成下划线。
 */
export const attachmentRefLine = (name: string, id: string): string =>
  `${ATTACHMENT_REF_PREFIX}${name.replaceAll(/[[\]\r\n]/g, "_")} (id: ${id})]`;

/** 引用行的匹配；`id` 是附件 id（64 位小写 hex） */
export const ATTACHMENT_REF_PATTERN = new RegExp(
  `${escapeRegExp(ATTACHMENT_REF_PREFIX)}([^\\][\\n]*?) \\(id: ([0-9a-f]{64})\\)\\]`,
  "g",
);
