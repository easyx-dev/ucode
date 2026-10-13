/**
 * 表格的展示偏好：单元格是否自动换行。
 *
 * 默认不换行——列多时靠卡片自己横向滚，不把内容挤成竖条；打开后按列宽折行。切换后记住选择：
 * 对话列表是虚拟滚动的，行一旦滚出视口就被卸载，只存在组件里的开关回来就没了；
 * 同屏的多张表也共用这一份（状态在 `hooks/use-table-wrap`，不是每张表各持一份）。
 * 存储不可用（隐私模式）由 `utils/storage` 兜住，存量值不认识则回落到默认值。
 */
import { brand } from "@ucode/brand/values";
import { readStorage, writeStorage } from "../../../utils/storage";

export const DEFAULT_TABLE_WRAP = false;

const WRAP_KEY = `${brand.slug}-table-wrap`;

/** 存量的原始值 → 是否自动换行；只认 `"true"` */
export const tableWrapOf = (raw: string | null): boolean => raw === "true";

export const readTableWrap = (): boolean => tableWrapOf(readStorage(WRAP_KEY));

export const writeTableWrap = (wrap: boolean): void => writeStorage(WRAP_KEY, String(wrap));
