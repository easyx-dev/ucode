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

/** 「设计」视图里列项目稿子的上限：扫到这么多就停，别让一棵大仓库把侧栏拖死 */
export const DESIGN_FILE_SCAN_MAX = 200;

/** 目录递归深度上限：设计稿通常就在项目里一两层，深挖没有意义 */
export const DESIGN_FILE_SCAN_MAX_DEPTH = 6;
