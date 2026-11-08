/** 设计画布的内建常量：落盘节奏、工具侧上限与文档文件格式 */

/** 一串连续改动合并成一次写盘：一段密集编辑只落一次盘 */
export const DESIGN_WRITE_DEBOUNCE_MS = 300;

/**
 * 一份文档的节点数上限。画布每改一次都要整页重渲染，而模型可以用一次调用建一个节点，
 * 没有上限时长会话能把服务端与浏览器一起拖住。
 */
export const DESIGN_MAX_NODES = 2000;

/** `design_get_tree` 一次返回的节点行上限：超出按层级截断并提示改用 design_find_nodes */
export const DESIGN_TREE_ROW_LIMIT = 300;

/** `design_find_nodes` 一次返回的匹配上限 */
export const DESIGN_FIND_LIMIT = 50;

/**
 * 一块画板（一屏）的默认尺寸。
 *
 * 画板是「一块屏」，所以新建画板时宽高不该落到通用的 100x100：种子图与 `design_create_shape`
 * 共用这一份，接口里不出现第二个手写数字。
 */
export const DESIGN_BOARD_SIZE = { width: 375, height: 812 } as const;

/** 画板之间的横向留白：新画板排在已有画板右侧时留出它，屏与屏不至于粘在一起 */
export const DESIGN_BOARD_GAP = 80;

/** 文档文件格式版本：形状不兼容时旧文件留档，不猜着读 */
export const DESIGN_DOCUMENT_FORMAT = 1;

/**
 * 设计稿文件的扩展名（内容仍是 JSON）。
 *
 * 不叫 `.json` 是为了让工作台的文件树能按扩展名认出它、点开就出画布预览；
 * 也不带会话 id——文件名取自会话标题，人一眼能认出是哪份稿子（见 `features/design/paths`）。
 */
export const DESIGN_FILE_EXTENSION = ".design";

/** 文件名里标题的截断长度：文件名不是标题，太长在树里挤成省略号 */
export const DESIGN_FILE_TITLE_MAX_LENGTH = 40;

/**
 * 存档图片的像素保真倍数：按节点尺寸的这么多倍存（视网膜屏够用）。
 *
 * 图片的字节既进 `.design` 文件（base64），也每帧进画布 SVG（data URI）——两处都随像素数线性涨，
 * 原样存一张几 MB 的照片会让文件与每一帧都变得读不动，所以入库时按它要显示的尺寸压一遍。
 */
export const DESIGN_IMAGE_PIXEL_RATIO = 2;

/** 单张图存档后的像素上限：全屏大图（画板 375x812 的两倍）也在这个尺寸以内 */
export const DESIGN_IMAGE_MAX_DIMENSION = 1600;

/** 单张图存档后的字节上限（base64 之前的编码字节）：再大就压质量，而不是存原图 */
export const DESIGN_IMAGE_MAX_BYTES = 256 * 1024;

/**
 * 一份稿子的图片总量上限。
 *
 * 画布每次刷新都下发整页 SVG，每张图的字节都在里面；没有这个上限，一份稿子能轻易压到几十 MB，
 * 每改一个节点都要重发一遍。到顶时报错让模型把不用的图片换回色块，而不是悄悄拖慢画布。
 */
export const DESIGN_IMAGE_TOTAL_BYTES = 2 * 1024 * 1024;
