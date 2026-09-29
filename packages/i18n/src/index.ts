/**
 * `@ucode/i18n`：跨端 i18n 运行时与共享目录。
 *
 * 只依赖 `i18next`，不依赖 React / DOM：各端用 `createI18n` 建自己的实例（web 另传
 * `initReactI18next` 插件），共享文案与「错误码 → 文案 key」映射从这里取。
 * 语言常量仍在 `@ucode/contracts`（契约层）。
 */
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@ucode/contracts";
import i18next, { type i18n as I18nInstance, type Resource, type ThirdPartyModule } from "i18next";

import { houseOptions } from "./config";
import commonEn from "./locales/common/en";
import commonZhCN from "./locales/common/zh-CN";
import domainEn from "./locales/domain/en";
import domainZhCN from "./locales/domain/zh-CN";
import uiEn from "./locales/ui/en";
import uiZhCN from "./locales/ui/zh-CN";

export { type ErrorMessageKey, errorMessageKey, errorMessageKeys } from "./error-messages";

/** 扁平文案目录：key 即文案，值是该语言的展示文本 */
export type Catalog = Record<string, string>;

/** 各端补充的文案目录，按语言给出（共享目录已含 common / domain / ui） */
export type AppCatalogs = Partial<Record<Locale, Catalog>>;

/** 共享目录的 key 集合（common + domain + ui），供各端 `i18next.d.ts` 做 key 类型约束 */
export type SharedCatalog = typeof commonEn & typeof domainEn & typeof uiEn;

/** 协议 / 客户端级通用文案 */
export const commonCatalogs: Record<Locale, Catalog> = {
  "zh-CN": commonZhCN,
  en: commonEn,
};

/** 与 ERROR_CODES / RuntimeStatus 对应的领域文案 */
export const domainCatalogs: Record<Locale, Catalog> = {
  "zh-CN": domainZhCN,
  en: domainEn,
};

/** 产品界面文案：web / Electron / TUI 等端共用的界面词汇 */
export const uiCatalogs: Record<Locale, Catalog> = {
  "zh-CN": uiZhCN,
  en: uiEn,
};

/** 各语言合并后的共享目录（重复 key 由 scripts/verify 拦下） */
const sharedCatalogs: Record<Locale, Catalog> = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    { ...commonCatalogs[locale], ...domainCatalogs[locale], ...uiCatalogs[locale] },
  ]),
) as Record<Locale, Catalog>;

export type CreateI18nConfig = {
  /** 初始语言，缺省 DEFAULT_LOCALE */
  lng?: Locale;
  /** 各端补充的文案目录，按语言给出；与共享目录扁平合并（重复 key 由校验拦下） */
  appCatalogs?: AppCatalogs;
  /** init 之前加载的 i18next 插件，如 web 的 `initReactI18next` */
  plugins?: ThirdPartyModule[];
};

/** 建一个独立的 i18next 实例（不用全局单例），套用 house 约定并合并共享 + 各端目录 */
export const createI18n = (config: CreateI18nConfig = {}): I18nInstance => {
  const instance = i18next.createInstance();
  for (const plugin of config.plugins ?? []) instance.use(plugin);

  const app = config.appCatalogs ?? {};
  const resources: Resource = {};
  for (const locale of LOCALES) {
    resources[locale] = { translation: { ...sharedCatalogs[locale], ...app[locale] } };
  }

  void instance.init({ ...houseOptions(config.lng ?? DEFAULT_LOCALE), resources });
  return instance;
};
