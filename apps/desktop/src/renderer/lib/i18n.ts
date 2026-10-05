/**
 * 桌面侧的 i18n 实例：接线逻辑在 `@ucode/ui/lib/app-i18n`，这里只持有应用单例。
 *
 * 副作用引入（在任何组件渲染前完成初始化）。
 */
import type { Translate } from "@ucode/sdk";
import { createAppI18n } from "@ucode/ui/lib/app-i18n";

const i18n = createAppI18n();

/** SDK 侧传的是动态 key，i18next 的 t 由中文 key 类型约束；此处收口一次断言 */
export const translate = i18n.t as unknown as Translate;

export default i18n;
