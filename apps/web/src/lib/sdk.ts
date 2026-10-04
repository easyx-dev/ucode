/** web 侧的 SDK 装配：创建实例并注入共享 UI 运行时（浏览器 fetch + i18n 文案） */
import type { Translate } from "@ucode/sdk";
import { createSdk } from "@ucode/sdk";
import { configureUi } from "@ucode/ui/runtime";

import i18n from "./i18n";

/** SDK 侧传的是动态 key，i18next 的 t 由中文 key 类型约束；此处收口一次断言 */
export const translate = i18n.t as unknown as Translate;

export const sdk = createSdk({ translate });

configureUi({ sdk, translate });
