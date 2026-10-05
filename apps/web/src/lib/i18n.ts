/**
 * web 侧的 i18n 实例：接线逻辑在 `@ucode/ui/lib/app-i18n`，这里只持有应用单例。
 *
 * 副作用引入（在任何组件渲染前完成初始化）。
 */
import { createAppI18n } from "@ucode/ui/lib/app-i18n";

export const i18n = createAppI18n();

export default i18n;
