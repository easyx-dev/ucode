/**
 * 让 `t()` 的 key 收敛到 `@ucode/i18n` 的共享目录（common / domain / ui），
 * 把拼错或漏登记的文案挡在编译期。
 */
import type { SharedCatalog } from "@ucode/i18n";
import "i18next";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: SharedCatalog };
    keySeparator: false;
    nsSeparator: false;
  }
}
