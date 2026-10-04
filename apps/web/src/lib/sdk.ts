/** web 侧的 SDK 装配：浏览器 fetch + i18n 错误文案，应用内单例 */
import type { Translate } from "@ucode/sdk";
import { createSdk } from "@ucode/sdk";

import i18n from "./i18n";

/** SDK 侧传的是动态 key，i18next 的 t 由中文 key 类型约束；此处收口一次断言 */
export const translate = i18n.t as unknown as Translate;

export const sdk = createSdk({ translate });
