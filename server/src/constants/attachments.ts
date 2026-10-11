/** 附件与图片：归一化的尺寸上限、草稿临时附件的保留时长与扫描间隔 */
/** 图片归一化的最长边（像素） */
export const IMAGE_MAX_DIMENSION = 2000;

/** 图片归一化后的编码字节上限 */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** 草稿临时附件的保留时长：只在草稿里引用过、从未随消息发送的附件超期清理 */
export const ATTACHMENT_TEMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 临时附件的扫描间隔 */
export const ATTACHMENT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
