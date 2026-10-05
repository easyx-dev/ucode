/** web 侧的客户端装配：创建实例并注入浏览器 fetch 与 i18n 错误文案 */
import type { Translate } from "@ucode/sdk";
import { createClient } from "@ucode/sdk";

import i18n from "./i18n";

/** SDK 侧传的是动态 key，i18next 的 t 由中文 key 类型约束；此处收口一次断言 */
export const translate = i18n.t as unknown as Translate;

export const client = createClient({ translate });
