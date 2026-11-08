/**
 * 设计稿里的图片：把本地图片文件归一化后收进文档的图片表。
 *
 * 三条口径：
 *
 * 1. **按显示尺寸存**。图片字节同时进 `.design` 文件（base64）与每一帧画布 SVG（data URI），
 *    两处都随像素数线性涨，所以入库时按目标节点的尺寸压一遍（`DESIGN_IMAGE_*`），不原样存原图。
 * 2. **按内容哈希去重**。同一份字节只存一份，名字用 SDK 的 `computeImageHash`（与 Figma 一致）——
 *    这样写进填充里的 `imageHash` 与文件里的键是同一个东西。
 * 3. **只认会话工作目录里的文件**。图片要么是项目里已有的素材，要么是 agent 先落到项目里再引用；
 *    不在这里开网络口子（下载归 bash / webfetch，存哪儿、多大由那一步负责）。
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { detectSupportedImageMimeTypeFromFile, resizeImage } from "@earendil-works/pi-coding-agent";
import type { SceneGraph } from "@open-pencil/scene-graph";

import {
  DESIGN_IMAGE_MAX_BYTES,
  DESIGN_IMAGE_MAX_DIMENSION,
  DESIGN_IMAGE_PIXEL_RATIO,
  DESIGN_IMAGE_TOTAL_BYTES,
} from "../../../constants/design";
import { expandHome, isInsidePath } from "../../../platform/paths";
import { designError } from "./errors";
import { loadDesignSdk } from "./sdk";

/** 一张已归一化、可以写进文档图片表的图 */
export type DesignImage = {
  /** 内容哈希：填充里的 `imageHash` 与文档 `images` 的键都用它 */
  hash: string;
  /** 编码后的字节（已按目标尺寸压过） */
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
  /** 源文件绝对路径：结果里报给模型，它才知道自己引的是哪张 */
  source: string;
  /** 是否真的重编码过（原图本来就够小就不动它） */
  resized: boolean;
};

export type LoadImageInput = {
  /** 图源：相对会话工作目录或绝对路径 */
  path: string;
  /** 会话工作目录：图片必须落在它里面 */
  cwd: string;
  /** 目标节点的显示尺寸：按它的倍数决定存档像素 */
  box: { width: number; height: number };
};

/** 存档像素：显示尺寸的倍数，夹在上下限之间（0 宽高的节点拿到的是最小可用尺寸） */
const archivePixels = (value: number): number =>
  Math.min(DESIGN_IMAGE_MAX_DIMENSION, Math.max(16, Math.round(value * DESIGN_IMAGE_PIXEL_RATIO)));

export const loadDesignImage = async (input: LoadImageInput): Promise<DesignImage> => {
  const expanded = expandHome(input.path.trim());
  const source = isAbsolute(expanded) ? expanded : resolve(input.cwd, expanded);
  if (!isInsidePath(input.cwd, source)) {
    throw designError(
      "invalid_input",
      `图片要在会话工作目录里：${source}`,
      `这个会话的工作目录是 ${input.cwd}；先把图下载 / 复制进来再引用`,
    );
  }
  const stats = await stat(source).catch(() => null);
  if (stats === null || !stats.isFile()) {
    throw designError(
      "not_found",
      `没有这个图片文件：${source}`,
      "路径相对会话工作目录；先确认文件存在（bash 里 ls 一下）",
    );
  }
  const mimeType = await detectSupportedImageMimeTypeFromFile(source);
  if (mimeType === null) {
    throw designError(
      "invalid_input",
      `这不是支持的图片格式：${source}`,
      "支持 png / jpeg / webp / gif；svg 与其它格式先用 bash 转成 png（sips -s format png）",
    );
  }
  const original = await readFile(source).catch((error: unknown) => {
    throw designError(
      "io_failed",
      `读取图片失败：${source}`,
      error instanceof Error ? error.message : String(error),
    );
  });
  const normalized = await resizeImage(original, mimeType, {
    maxWidth: archivePixels(input.box.width),
    maxHeight: archivePixels(input.box.height),
    maxBytes: DESIGN_IMAGE_MAX_BYTES,
  });
  if (normalized === null) {
    throw designError(
      "invalid_input",
      `这张图压不进 ${Math.round(DESIGN_IMAGE_MAX_BYTES / 1024)}KB：${source}`,
      "换一张图，或先把它缩到目标尺寸附近再引用",
    );
  }
  const bytes = Uint8Array.from(Buffer.from(normalized.data, "base64"));
  const sdk = await loadDesignSdk();
  return {
    hash: sdk.computeImageHash(bytes),
    bytes,
    width: normalized.width,
    height: normalized.height,
    mimeType: normalized.mimeType,
    source,
    resized: normalized.wasResized,
  };
};

/** 文档里被填充 / 描边引用到的图片哈希；其余字节只是历史残留 */
export const referencedImageHashes = (graph: SceneGraph): Set<string> => {
  const hashes = new Set<string>();
  for (const node of graph.nodes.values()) {
    for (const paint of [...node.fills, ...node.strokes]) {
      if (paint.imageHash !== undefined) hashes.add(paint.imageHash);
    }
  }
  return hashes;
};

/** 图片总量（只算还在用的）：判上限用它，把已换回色块的图腾出来 */
const usedImageBytes = (graph: SceneGraph): number => {
  let total = 0;
  for (const hash of referencedImageHashes(graph)) {
    total += graph.images.get(hash)?.byteLength ?? 0;
  }
  return total;
};

/**
 * 加图前的总量校验：到顶就报错，而不是悄悄把画布拖成一帧几十 MB。
 *
 * 上限算的是**引用中的字节**：没人引用的残留不该占着名额（它们会在下一次改动时被 prune 掉）。
 */
export const assertImageBudget = (graph: SceneGraph, incoming: DesignImage): void => {
  if (graph.images.has(incoming.hash)) return;
  if (usedImageBytes(graph) + incoming.bytes.byteLength <= DESIGN_IMAGE_TOTAL_BYTES) return;
  throw designError(
    "limit_exceeded",
    `这份稿子里的图片总量会超过上限（${Math.round(DESIGN_IMAGE_TOTAL_BYTES / 1024)}KB）`,
    "把不用的图片填充换回色块（design_set_fill）后再加新图，或换更小的图",
  );
};

/**
 * 丢掉没人引用的图片字节。
 *
 * 不丢的话「先设图、再换回色块」会把字节一直留在内存与文件里：`.design` 只涨不缩，
 * 画布每次刷新也仍然要把它们编进 SVG。
 */
export const pruneUnreferencedImages = (graph: SceneGraph): number => {
  const hashes = referencedImageHashes(graph);
  let dropped = 0;
  for (const hash of [...graph.images.keys()]) {
    if (hashes.has(hash)) continue;
    graph.images.delete(hash);
    dropped += 1;
  }
  return dropped;
};
